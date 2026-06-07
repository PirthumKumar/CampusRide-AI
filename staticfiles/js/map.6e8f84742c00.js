// CAMPUSRIDE INTERACTIVE MAP SERVICE (LEAFLET.JS & OPENSTREETMAP WRAPPER)

const CampusMap = {
    map: null,
    driverMarker: null,
    markers: [],
    polylines: [],
    tempMarkers: {},
    defaultCenter: [33.6428, 72.9904], // NUST, Islamabad, Pakistan
    defaultZoom: 13,
    tileLayerUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileLayerAttrib: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',


    init(elementId, onClickCallback = null) {
        if (typeof L === 'undefined') {
            console.error("Leaflet library L is not loaded.");
            return null;
        }

        // Fix leaflet map default marker icons (crucial for React/Vite/Bundlers)
        if (L.Icon && L.Icon.Default) {
            delete L.Icon.Default.prototype._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
                iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
                shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
            });
        }

        if (this.map) {
            this.map.remove();
        }

        // Define strict bounding box for Pakistan
        const pakistanBounds = L.latLngBounds([23.0, 60.0], [38.0, 79.0]);

        // Initialize Leaflet map
        this.map = L.map(elementId, {
            zoomControl: true,
            attributionControl: true,
            maxBounds: pakistanBounds,
            maxBoundsViscosity: 1.0,
            minZoom: 5
        }).setView(this.defaultCenter, this.defaultZoom);

        // Add default bright OpenStreetMap tiles
        L.tileLayer(this.tileLayerUrl, {
            attribution: this.tileLayerAttrib,
            maxZoom: 20
        }).addTo(this.map);

        this.markers = [];
        this.polylines = [];
        this.tempMarkers = {};

        // Register map clicks for point selection
        if (onClickCallback) {
            this.map.on('click', (e) => {
                onClickCallback(e.latlng.lat, e.latlng.lng);
            });
        }

        // Fix leaflet map sizing bugs in flex layouts
        setTimeout(() => {
            if (this.map) this.map.invalidateSize();
        }, 300);

        return this.map;
    },

    clearMap() {
        if (!this.map) return;

        // Clear persistent markers
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];

        // Clear route lines
        this.polylines.forEach(p => this.map.removeLayer(p));
        this.polylines = [];

        // Clear temporary selection markers
        for (let key in this.tempMarkers) {
            if (this.tempMarkers[key]) {
                this.map.removeLayer(this.tempMarkers[key]);
            }
        }
        this.tempMarkers = {};
    },

    // Set interactive pickup/drop-off marker during ride creation or search
    setSelectionMarker(type, lat, lng, name = "") {
        if (!this.map) return;

        if (this.tempMarkers[type]) {
            this.map.removeLayer(this.tempMarkers[type]);
        }

        const color = type === 'pickup' ? '#6366f1' : '#ec4899';
        const label = type.toUpperCase();

        const customIcon = L.divIcon({
            className: 'custom-map-marker',
            html: `<div style="
                background: ${color};
                width: 14px;
                height: 14px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 0 10px ${color};
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(this.map);
        marker.bindPopup(`<b>${label} Point</b><br>${name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}`).openPopup();
        
        this.tempMarkers[type] = marker;
        this.panTo(lat, lng);

        // Add a route line/polyline between pickup and dropoff if both coordinates exist in tempMarkers
        this.drawSelectionRoute();
    },

    // Dynamic routing path calculation for interactive point picks
    drawSelectionRoute() {
        if (!this.map) return;

        // Clear previous temporary route line
        if (this.tempMarkers['selectionRoute']) {
            this.map.removeLayer(this.tempMarkers['selectionRoute']);
            delete this.tempMarkers['selectionRoute'];
        }

        if (this.tempMarkers['pickup'] && this.tempMarkers['dropoff']) {
            const startCoords = this.tempMarkers['pickup'].getLatLng();
            const endCoords = this.tempMarkers['dropoff'].getLatLng();
            const start = [startCoords.lat, startCoords.lng];
            const end = [endCoords.lat, endCoords.lng];

            // Fetch OSRM route path
            const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;

            fetch(url)
                .then(response => {
                    if (!response.ok) throw new Error("OSRM routing request failed");
                    return response.json();
                })
                .then(data => {
                    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                        throw new Error("No route found between coordinates");
                    }
                    if (!this.map || !this.tempMarkers['pickup'] || !this.tempMarkers['dropoff']) return;

                    // Clear previous route if any
                    if (this.tempMarkers['selectionRoute']) {
                        this.map.removeLayer(this.tempMarkers['selectionRoute']);
                    }

                    const geometry = data.routes[0].geometry;
                    const routeLine = L.geoJSON(geometry, {
                        style: {
                            color: '#6366f1',
                            weight: 5,
                            opacity: 0.75,
                            lineCap: 'round',
                            lineJoin: 'round'
                        }
                    }).addTo(this.map);

                    this.tempMarkers['selectionRoute'] = routeLine;
                })
                .catch(error => {
                    console.warn("OSRM temp routing error, drawing fallback line:", error);
                    if (!this.map || !this.tempMarkers['pickup'] || !this.tempMarkers['dropoff']) return;

                    if (this.tempMarkers['selectionRoute']) {
                        this.map.removeLayer(this.tempMarkers['selectionRoute']);
                    }

                    const polyline = L.polyline([start, end], {
                        color: 'rgba(99, 102, 241, 0.6)',
                        weight: 3,
                        dashArray: '5, 10'
                    }).addTo(this.map);

                    this.tempMarkers['selectionRoute'] = polyline;
                });
        }
    },

    setSearchMarker(lat, lng, displayName, mapType) {
        if (!this.map) return;

        this.clearSearchMarker();

        const searchIcon = L.divIcon({
            className: 'search-location-marker',
            html: `<div style="
                background: #f59e0b;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 0 10px #f59e0b;
            "></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7]
        });

        const marker = L.marker([lat, lng], { icon: searchIcon }).addTo(this.map);
        
        const popupHtml = `
            <div style="font-family: 'Inter', sans-serif; color: white; padding: 4px; width: 180px;">
                <b style="font-size: 11px;">Selected Location</b>
                <p style="font-size: 11px; margin: 4px 0 8px 0; color: #d1d5db;">${displayName}</p>
                <div style="display: flex; gap: 8px;">
                    <button onclick="window.setPointFromSearch('${mapType}', 'pickup', ${lat}, ${lng}, '${displayName.replace(/'/g, "\\'")}')" class="btn btn-primary btn-sm" style="font-size: 9px; padding: 4px 8px; cursor: pointer;">Set Pickup</button>
                    <button onclick="window.setPointFromSearch('${mapType}', 'dropoff', ${lat}, ${lng}, '${displayName.replace(/'/g, "\\'")}')" class="btn btn-secondary btn-sm" style="font-size: 9px; padding: 4px 8px; cursor: pointer;">Set Dropoff</button>
                </div>
            </div>
        `;
        
        marker.bindPopup(popupHtml).openPopup();
        this.tempMarkers['search'] = marker;
        this.panTo(lat, lng);
    },

    clearSearchMarker() {
        if (this.map && this.tempMarkers['search']) {
            this.map.removeLayer(this.tempMarkers['search']);
            delete this.tempMarkers['search'];
        }
    },

    panTo(lat, lng, zoom = 14) {
        if (this.map) {
            this.map.setView([lat, lng], zoom);
        }
    },

    showRides(ridesList, onRideSelectCallback) {
        if (!this.map) return;

        this.clearMap();

        if (!ridesList || ridesList.length === 0) return;

        const bounds = [];

        ridesList.forEach(ride => {
            const pickupCoords = [ride.pickup_lat, ride.pickup_lng];
            const dropoffCoords = [ride.dropoff_lat, ride.dropoff_lng];
            bounds.push(pickupCoords, dropoffCoords);

            // Add pickup marker
            const pickupIcon = L.divIcon({
                className: 'ride-pickup-marker',
                html: `<div style="
                    background: #6366f1;
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 3px solid #06070d;
                    box-shadow: 0 0 12px #6366f1;
                "></div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });

            const marker = L.marker(pickupCoords, { icon: pickupIcon }).addTo(this.map);
            
            // Build modern popup HTML
            const popupContent = `
                <div style="font-family: 'Inter', sans-serif; color: white; width: 220px; padding: 4px;">
                    <h4 style="font-family: 'Outfit'; font-weight: 700; margin-bottom: 6px; font-size: 14px;">Ride by @${ride.driver.username}</h4>
                    <p style="font-size: 11px; color: #9ca3af; margin-bottom: 8px;">
                        <i class="ri-map-pin-line"></i> ${ride.pickup_name.substring(0, 30)}...
                    </p>
                    <p style="font-size: 11px; color: #9ca3af; margin-bottom: 8px;">
                        <i class="ri-flag-line"></i> ${ride.dropoff_name.substring(0, 30)}...
                    </p>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
                        <div>
                            <span style="font-size: 14px; font-weight: 800;">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}</span>
                            <span style="font-size: 9px; color: #9ca3af;">/seat</span>
                        </div>
                        <button onclick="window.showRideDetailFromMap(${ride.id})" style="
                            background: #6366f1;
                            color: white;
                            border: none;
                            padding: 6px 12px;
                            border-radius: 4px;
                            font-size: 11px;
                            font-weight: 600;
                            cursor: pointer;
                        ">Book Now</button>
                    </div>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            this.markers.push(marker);

            // Connect pickup to dropoff with a dotted line on overview map
            const polyline = L.polyline([pickupCoords, dropoffCoords], {
                color: 'rgba(99, 102, 241, 0.4)',
                weight: 2,
                dashArray: '5, 10'
            }).addTo(this.map);
            this.polylines.push(polyline);
        });

        // Fit map bounds to show all rides
        if (bounds.length > 0) {
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    },

    drawRoutePath(startCoords, endCoords, stopsList = []) {
        if (!this.map) return;

        // Clear previous paths & markers
        this.clearMap();

        const bounds = [startCoords, endCoords];

        // Draw Driver Start and End
        const startIcon = L.divIcon({
            className: 'driver-start-marker',
            html: `<div style="background:#6366f1; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px #6366f1; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">D</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const startMarker = L.marker(startCoords, { icon: startIcon }).addTo(this.map).bindPopup("Driver Start Location");
        this.markers.push(startMarker);

        const endIcon = L.divIcon({
            className: 'driver-end-marker',
            html: `<div style="background:#ec4899; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px #ec4899; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">F</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        const endMarker = L.marker(endCoords, { icon: endIcon }).addTo(this.map).bindPopup("Driver Final Destination");
        this.markers.push(endMarker);

        // Draw Intermediate passenger stops
        const routeCoords = [startCoords];

        stopsList.forEach((stop, index) => {
            if (stop.type === 'start' || stop.type === 'end') return;

            const coords = stop.coords;
            bounds.push(coords);
            routeCoords.push(coords);

            // Determine if pickup (green) or dropoff (yellow)
            const color = stop.type === 'pickup' ? '#10b981' : '#f59e0b';
            const iconChar = stop.type === 'pickup' ? 'P' : 'D';
            
            const stopIcon = L.divIcon({
                className: 'passenger-stop-marker',
                html: `<div style="background:${color}; width:18px; height:18px; border-radius:50%; border:2.5px solid white; box-shadow:0 0 10px ${color}; display:flex; align-items:center; justify-content:center; color:white; font-size:9px; font-weight:bold;">${iconChar}</div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            });

            const stopMarker = L.marker(coords, { icon: stopIcon })
                .addTo(this.map)
                .bindPopup(`<b>Stop #${index}: ${stop.name}</b>`);
            this.markers.push(stopMarker);
        });

        routeCoords.push(endCoords);

        // Draw solid driving path connection
        const drivingPath = L.polyline(routeCoords, {
            color: '#6366f1',
            weight: 4,
            opacity: 0.85,
            shadowColor: '#6366f1',
            shadowBlur: 10
        }).addTo(this.map);
        this.polylines.push(drivingPath);

        // Fit map bounds
        this.map.fitBounds(bounds, { padding: [60, 60] });
    },

    async fetchRouteAndDirections(startCoords, endCoords) {
        const startLat = startCoords[0];
        const startLng = startCoords[1];
        const endLat = endCoords[0];
        const endLng = endCoords[1];

        // OSRM expects: longitude,latitude (free routing engine)
        const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson&steps=true`;

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CampusRide-Student-Carpool/1.0 (Student Carpool App)'
                }
            });
            if (!response.ok) throw new Error("OSRM routing request failed");
            const data = await response.json();
            
            if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
                throw new Error("No route found between coordinates");
            }

            const route = data.routes[0];
            const geometry = route.geometry;
            const distanceKm = route.distance / 1000.0;
            const durationMin = route.duration / 60.0;

            // Clear previous route lines
            this.polylines.forEach(p => this.map.removeLayer(p));
            this.polylines = [];

            // Draw route polyline with glowing design
            const routeLine = L.geoJSON(geometry, {
                style: {
                    color: '#6366f1',
                    weight: 6,
                    opacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round'
                }
            }).addTo(this.map);

            this.polylines.push(routeLine);

            // Fit map bounds
            const bounds = L.latLngBounds([startCoords, endCoords]);
            this.map.fitBounds(bounds, { padding: [50, 50] });

            // Extract instructions
            const steps = [];
            if (route.legs && route.legs[0] && route.legs[0].steps) {
                route.legs[0].steps.forEach((step) => {
                    if (step.maneuver && step.maneuver.instruction) {
                        steps.push({
                            instruction: step.maneuver.instruction,
                            distance: step.distance,
                            name: step.name || ""
                        });
                    }
                });
            }

            return {
                distance_km: distanceKm,
                duration_min: durationMin,
                steps: steps
            };
        } catch (error) {
            console.error("OSRM Routing error:", error);
            // Draw simple dotted line fallback
            this.polylines.forEach(p => this.map.removeLayer(p));
            this.polylines = [];
            const polyline = L.polyline([startCoords, endCoords], {
                color: 'rgba(99, 102, 241, 0.6)',
                weight: 3,
                dashArray: '5, 10'
            }).addTo(this.map);
            this.polylines.push(polyline);
            
            const straightDist = this.haversineDistance(startLat, startLng, endLat, endLng);
            return {
                distance_km: straightDist * 1.25,
                duration_min: straightDist * 2.0,
                steps: [
                    { instruction: "Proceed from pickup to dropoff via general route.", distance: straightDist * 1000 }
                ],
                isFallback: true
            };
        }
    },

    haversineDistance(lat1, lon1, lat2, lon2) {
        const R = 6371.0;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    },

    updateDriverMarker(lat, lng) {
        if (!this.map) return;

        if (this.driverMarker) {
            this.driverMarker.setLatLng([lat, lng]);
        } else {
            this.driverMarker = L.circleMarker([lat, lng], {
                radius: 10,
                color: '#3b82f6',
                fillColor: '#3b82f6',
                fillOpacity: 0.6,
                weight: 3,
                className: 'pulse-driver-marker'
            }).addTo(this.map);
            this.driverMarker.bindPopup("<b>Driver is here</b>").openPopup();
        }
    },

    clearDriverMarker() {
        if (this.map && this.driverMarker) {
            this.map.removeLayer(this.driverMarker);
            this.driverMarker = null;
        }
    }
};
