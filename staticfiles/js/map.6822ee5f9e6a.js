// CAMPUSRIDE INTERACTIVE MAP SERVICE (GOOGLE MAPS API WRAPPER WITH LAZY TIMING QUEUE)

let HTMLMarker = null;

function initHTMLMarkerClass() {
    if (HTMLMarker) return;
    
    // Custom HTML Marker Overlay class utilizing google.maps.OverlayView
    HTMLMarker = class extends google.maps.OverlayView {
        constructor(latlng, map, html) {
            super();
            this.latlng = latlng;
            this.html = html;
            this.div = null;
            this.setMap(map);
        }

        onAdd() {
            this.div = document.createElement('div');
            this.div.style.position = 'absolute';
            this.div.style.cursor = 'pointer';
            this.div.innerHTML = this.html;
            
            const panes = this.getPanes();
            panes.overlayMouseTarget.appendChild(this.div);

            // Add click event propagation prevention and trigger custom map event
            google.maps.event.addDomListener(this.div, 'click', (e) => {
                google.maps.event.trigger(this, 'click');
                e.stopPropagation();
            });
        }

        draw() {
            const projection = this.getProjection();
            if (!projection) return;
            const point = projection.fromLatLngToDivPixel(this.latlng);
            if (point && this.div) {
                this.div.style.left = point.x + 'px';
                this.div.style.top = point.y + 'px';
                this.div.style.transform = 'translate(-50%, -50%)'; // Perfectly centers HTML marker on coordinate
            }
        }

        onRemove() {
            if (this.div) {
                if (this.div.parentNode) {
                    this.div.parentNode.removeChild(this.div);
                }
                this.div = null;
            }
        }

        getPosition() {
            return this.latlng;
        }

        setPosition(latlng) {
            this.latlng = latlng;
            this.draw();
        }
    };
}

// Custom dark mode theme styles matching CartoDB Dark Matter
const googleMapsDarkTheme = [
    { elementType: "geometry", stylers: [{ color: "#111827" }] }, // dark gray
    { elementType: "labels.text.stroke", stylers: [{ color: "#111827" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#9ca3af" }] },
    {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{ color: "#f3f4f6" }]
    },
    {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d1d5db" }]
    },
    {
        featureType: "poi.park",
        elementType: "geometry",
        stylers: [{ color: "#0f172a" }]
    },
    {
        featureType: "poi.park",
        elementType: "labels.text.fill",
        stylers: [{ color: "#6b7280" }]
    },
    {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#1f2937" }] // gray-800
    },
    {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#111827" }]
    },
    {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{ color: "#9ca3af" }]
    },
    {
        featureType: "road.highway",
        elementType: "geometry",
        stylers: [{ color: "#374151" }] // gray-700
    },
    {
        featureType: "road.highway",
        elementType: "geometry.stroke",
        stylers: [{ color: "#111827" }]
    },
    {
        featureType: "road.highway",
        elementType: "labels.text.fill",
        stylers: [{ color: "#e5e7eb" }]
    },
    {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{ color: "#1f2937" }]
    },
    {
        featureType: "transit.station",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d1d5db" }]
    },
    {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#030712" }] // deep blackish water
    },
    {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [{ color: "#4b5563" }]
    },
    {
        featureType: "water",
        elementType: "labels.stroke",
        stylers: [{ color: "#030712" }]
    }
];

const CampusMap = {
    map: null,
    driverMarker: null,
    markers: [],
    polylines: [],
    tempMarkers: {},
    defaultCenter: [33.6428, 72.9904], // NUST, Islamabad, Pakistan
    defaultZoom: 13,

    // Queue for operations performed before API is ready
    initQueue: [],
    pendingShowRides: null,
    pendingSelectionMarkers: {},
    pendingSearchMarker: null,
    pendingRoutePath: null,
    pendingDriverMarker: null,
    pendingPan: null,

    init(elementId, onClickCallback = null) {
        // If google maps is not loaded yet, queue this call!
        if (typeof google === 'undefined' || !google.maps) {
            console.warn(`Google Maps not loaded yet. Queueing map initialization for #${elementId}...`);
            this.initQueue.push({ elementId, onClickCallback });
            return null;
        }

        // Initialize lazy HTML Marker class
        initHTMLMarkerClass();

        const mapElement = document.getElementById(elementId);
        if (!mapElement) {
            console.error(`Map element with ID #${elementId} not found.`);
            return null;
        }

        // Initialize Google Maps instance
        this.map = new google.maps.Map(mapElement, {
            center: { lat: this.defaultCenter[0], lng: this.defaultCenter[1] },
            zoom: this.defaultZoom,
            styles: googleMapsDarkTheme,
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            gestureHandling: 'cooperative'
        });

        this.markers = [];
        this.polylines = [];
        this.tempMarkers = {};

        // Register map clicks for point selection
        if (onClickCallback) {
            this.map.addListener('click', (e) => {
                onClickCallback(e.latLng.lat(), e.latLng.lng());
            });
        }

        return this.map;
    },

    processInitQueue() {
        if (this.initQueue.length > 0) {
            console.log(`Processing ${this.initQueue.length} queued map initializations...`);
            const queue = [...this.initQueue];
            this.initQueue = [];
            queue.forEach(item => {
                this.init(item.elementId, item.onClickCallback);
            });

            // Trigger all queued/pending operations in order
            if (this.pendingShowRides) {
                console.log("Processing pending showRides call...");
                this.showRides(this.pendingShowRides.ridesList, this.pendingShowRides.onRideSelectCallback);
                this.pendingShowRides = null;
            }
            if (Object.keys(this.pendingSelectionMarkers).length > 0) {
                console.log("Processing pending selection markers...");
                for (let type in this.pendingSelectionMarkers) {
                    const item = this.pendingSelectionMarkers[type];
                    this.setSelectionMarker(type, item.lat, item.lng, item.name);
                }
                this.pendingSelectionMarkers = {};
            }
            if (this.pendingSearchMarker) {
                console.log("Processing pending search marker...");
                const item = this.pendingSearchMarker;
                this.setSearchMarker(item.lat, item.lng, item.displayName, item.mapType);
                this.pendingSearchMarker = null;
            }
            if (this.pendingRoutePath) {
                console.log("Processing pending route path...");
                const item = this.pendingRoutePath;
                this.drawRoutePath(item.startCoords, item.endCoords, item.stopsList);
                this.pendingRoutePath = null;
            }
            if (this.pendingDriverMarker) {
                console.log("Processing pending driver marker...");
                const item = this.pendingDriverMarker;
                this.updateDriverMarker(item.lat, item.lng);
                this.pendingDriverMarker = null;
            }
            if (this.pendingPan) {
                console.log("Processing pending panTo...");
                const item = this.pendingPan;
                this.panTo(item.lat, item.lng, item.zoom);
                this.pendingPan = null;
            }
        }
    },

    clearMap() {
        if (this.map) {
            // Clear persistent markers
            this.markers.forEach(m => m.setMap(null));
            // Clear route lines
            this.polylines.forEach(p => p.setMap(null));
            // Clear temporary selection markers
            for (let key in this.tempMarkers) {
                if (this.tempMarkers[key]) {
                    this.tempMarkers[key].setMap(null);
                }
            }
        }
        this.markers = [];
        this.polylines = [];
        this.tempMarkers = {};
        
        // Reset pending states when explicitly cleared
        this.pendingShowRides = null;
        this.pendingSelectionMarkers = {};
        this.pendingSearchMarker = null;
        this.pendingRoutePath = null;
        this.pendingDriverMarker = null;
        this.pendingPan = null;
    },

    // Set interactive pickup/drop-off marker during ride creation or search
    setSelectionMarker(type, lat, lng, name = "") {
        if (!this.map) {
            this.pendingSelectionMarkers[type] = { lat, lng, name };
            return;
        }

        if (this.tempMarkers[type]) {
            this.tempMarkers[type].setMap(null);
        }

        const color = type === 'pickup' ? '#6366f1' : '#ec4899';
        const label = type.toUpperCase();

        const html = `<div class="custom-map-marker" style="
            background: ${color};
            width: 14px;
            height: 14px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 0 10px ${color};
        "></div>`;

        const latLng = new google.maps.LatLng(lat, lng);
        const marker = new HTMLMarker(latLng, this.map, html);

        const popupContent = `
            <div style="font-family: 'Inter', sans-serif; color: #111827; padding: 4px; font-size: 11px; font-weight: 500;">
                <b style="color: ${color}; font-weight: 700;">${label} Point</b><br>${name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
            </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({
            content: popupContent
        });

        google.maps.event.addListener(marker, 'click', () => {
            infoWindow.setPosition(marker.getPosition());
            infoWindow.open(this.map);
        });
        
        // Open popup automatically
        setTimeout(() => {
            infoWindow.setPosition(marker.getPosition());
            infoWindow.open(this.map);
        }, 150);

        this.tempMarkers[type] = marker;
        this.panTo(lat, lng);
    },

    setSearchMarker(lat, lng, displayName, mapType) {
        if (!this.map) {
            this.pendingSearchMarker = { lat, lng, displayName, mapType };
            return;
        }

        this.clearSearchMarker();

        const html = `
            <div class="search-location-marker" style="
                background: #f59e0b;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 0 10px #f59e0b;
            "></div>
        `;
        const latLng = new google.maps.LatLng(lat, lng);
        const marker = new HTMLMarker(latLng, this.map, html);
        this.tempMarkers['search'] = marker;

        const popupHtml = `
            <div style="font-family: 'Inter', sans-serif; color: #111827; padding: 4px; width: 180px; font-size: 11px;">
                <b style="color: #d97706; font-weight: 700;">Selected Location</b>
                <p style="font-size: 11px; margin: 4px 0 8px 0; color: #4b5563; line-height: 1.4;">${displayName}</p>
                <div style="display: flex; gap: 8px;">
                    <button onclick="window.setPointFromSearch('${mapType}', 'pickup', ${lat}, ${lng}, '${displayName.replace(/'/g, "\\'")}')" class="btn btn-primary btn-sm" style="font-size: 9px; padding: 4px 8px; cursor: pointer; border-radius: 3px;">Set Pickup</button>
                    <button onclick="window.setPointFromSearch('${mapType}', 'dropoff', ${lat}, ${lng}, '${displayName.replace(/'/g, "\\'")}')" class="btn btn-secondary btn-sm" style="font-size: 9px; padding: 4px 8px; cursor: pointer; border-radius: 3px;">Set Dropoff</button>
                </div>
            </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({
            content: popupHtml
        });
        
        google.maps.event.addListener(marker, 'click', () => {
            infoWindow.setPosition(marker.getPosition());
            infoWindow.open(this.map);
        });

        // Open popup immediately
        setTimeout(() => {
            infoWindow.setPosition(marker.getPosition());
            infoWindow.open(this.map);
        }, 150);
    },

    clearSearchMarker() {
        if (this.tempMarkers['search']) {
            this.tempMarkers['search'].setMap(null);
            delete this.tempMarkers['search'];
        }
        this.pendingSearchMarker = null;
    },

    panTo(lat, lng, zoom = 14) {
        if (!this.map) {
            this.pendingPan = { lat, lng, zoom };
            return;
        }
        this.map.panTo({ lat, lng });
        this.map.setZoom(zoom);
    },

    showRides(ridesList, onRideSelectCallback) {
        if (!this.map) {
            this.pendingShowRides = { ridesList, onRideSelectCallback };
            return;
        }

        this.clearMap();

        if (!ridesList || ridesList.length === 0) return;

        const bounds = new google.maps.LatLngBounds();

        ridesList.forEach(ride => {
            const pickupCoords = { lat: parseFloat(ride.pickup_lat), lng: parseFloat(ride.pickup_lng) };
            const dropoffCoords = { lat: parseFloat(ride.dropoff_lat), lng: parseFloat(ride.dropoff_lng) };
            
            bounds.extend(pickupCoords);
            bounds.extend(dropoffCoords);

            // Add pickup marker with sleek design
            const html = `<div style="
                background: #6366f1;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 3px solid #06070d;
                box-shadow: 0 0 12px #6366f1;
            "></div>`;

            const marker = new HTMLMarker(new google.maps.LatLng(pickupCoords.lat, pickupCoords.lng), this.map, html);
            
            const popupContent = `
                <div style="font-family: 'Inter', sans-serif; color: #111827; width: 220px; padding: 4px;">
                    <h4 style="font-family: 'Outfit'; font-weight: 700; margin-bottom: 6px; font-size: 14px; color: #111827;">Ride by @${ride.driver.username}</h4>
                    <p style="font-size: 11px; color: #4b5563; margin-bottom: 8px;">
                        <i class="ri-map-pin-line"></i> ${ride.pickup_name.substring(0, 30)}...
                    </p>
                    <p style="font-size: 11px; color: #4b5563; margin-bottom: 8px;">
                        <i class="ri-flag-line"></i> ${ride.dropoff_name.substring(0, 30)}...
                    </p>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 8px;">
                        <div>
                            <span style="font-size: 14px; font-weight: 800; color: #111827;">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}</span>
                            <span style="font-size: 9px; color: #6b7280;">/seat</span>
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
            
            const infoWindow = new google.maps.InfoWindow({
                content: popupContent
            });

            google.maps.event.addListener(marker, 'click', () => {
                infoWindow.setPosition(marker.getPosition());
                infoWindow.open(this.map);
            });

            this.markers.push(marker);

            // Connect pickup to dropoff with a custom dashed polyline
            const polyline = new google.maps.Polyline({
                path: [pickupCoords, dropoffCoords],
                strokeColor: '#6366f1',
                strokeOpacity: 0, 
                strokeWeight: 2,
                icons: [{
                    icon: {
                        path: 'M 0,-1 0,1',
                        strokeOpacity: 0.5,
                        scale: 2
                    },
                    offset: '0',
                    repeat: '10px'
                }]
            });
            polyline.setMap(this.map);
            this.polylines.push(polyline);
        });

        // Fit map bounds to show all rides
        if (!bounds.isEmpty()) {
            this.map.fitBounds(bounds);
        }
    },

    drawRoutePath(startCoords, endCoords, stopsList = []) {
        if (!this.map) {
            this.pendingRoutePath = { startCoords, endCoords, stopsList };
            return;
        }

        this.clearMap();

        const bounds = new google.maps.LatLngBounds();
        const startLatLng = { lat: startCoords[0], lng: startCoords[1] };
        const endLatLng = { lat: endCoords[0], lng: endCoords[1] };
        
        bounds.extend(startLatLng);
        bounds.extend(endLatLng);

        // Draw Driver Start marker
        const startHtml = `<div style="background:#6366f1; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px #6366f1; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">D</div>`;
        const startMarker = new HTMLMarker(new google.maps.LatLng(startLatLng.lat, startLatLng.lng), this.map, startHtml);
        
        const startInfo = new google.maps.InfoWindow({
            content: '<div style="color:#111827; font-size:11px; font-family:\'Inter\';"><b>Driver Start Location</b></div>'
        });
        google.maps.event.addListener(startMarker, 'click', () => {
            startInfo.setPosition(startMarker.getPosition());
            startInfo.open(this.map);
        });
        this.markers.push(startMarker);

        // Draw Driver End marker
        const endHtml = `<div style="background:#ec4899; width:20px; height:20px; border-radius:50%; border:3px solid white; box-shadow:0 0 15px #ec4899; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold;">F</div>`;
        const endMarker = new HTMLMarker(new google.maps.LatLng(endLatLng.lat, endLatLng.lng), this.map, endHtml);
        
        const endInfo = new google.maps.InfoWindow({
            content: '<div style="color:#111827; font-size:11px; font-family:\'Inter\';"><b>Driver Final Destination</b></div>'
        });
        google.maps.event.addListener(endMarker, 'click', () => {
            endInfo.setPosition(endMarker.getPosition());
            endInfo.open(this.map);
        });
        this.markers.push(endMarker);

        const routeCoords = [startLatLng];

        stopsList.forEach((stop, index) => {
            if (stop.type === 'start' || stop.type === 'end') return;

            const coords = { lat: stop.coords[0], lng: stop.coords[1] };
            bounds.extend(coords);
            routeCoords.push(coords);

            // Determine stop marker color
            const color = stop.type === 'pickup' ? '#10b981' : '#f59e0b';
            const iconChar = stop.type === 'pickup' ? 'P' : 'D';
            
            const stopHtml = `<div style="background:${color}; width:18px; height:18px; border-radius:50%; border:2.5px solid white; box-shadow:0 0 10px ${color}; display:flex; align-items:center; justify-content:center; color:white; font-size:9px; font-weight:bold;">${iconChar}</div>`;
            const stopMarker = new HTMLMarker(new google.maps.LatLng(coords.lat, coords.lng), this.map, stopHtml);
            
            const stopInfo = new google.maps.InfoWindow({
                content: `<div style="color:#111827; font-size:11px; font-family:\'Inter\';"><b>Stop #${index}: ${stop.name}</b></div>`
            });
            google.maps.event.addListener(stopMarker, 'click', () => {
                stopInfo.setPosition(stopMarker.getPosition());
                stopInfo.open(this.map);
            });
            this.markers.push(stopMarker);
        });

        routeCoords.push(endLatLng);

        // Draw solid driving path connection
        const drivingPath = new google.maps.Polyline({
            path: routeCoords,
            strokeColor: '#6366f1',
            strokeOpacity: 0.85,
            strokeWeight: 4
        });
        drivingPath.setMap(this.map);
        this.polylines.push(drivingPath);

        // Fit map bounds
        this.map.fitBounds(bounds);
    },

    async fetchRouteAndDirections(startCoords, endCoords) {
        const startLat = startCoords[0];
        const startLng = startCoords[1];
        const endLat = endCoords[0];
        const endLng = endCoords[1];

        // Ensure google directions is available
        if (typeof google !== 'undefined' && google.maps && google.maps.DirectionsService) {
            const directionsService = new google.maps.DirectionsService();
            const startLatLng = new google.maps.LatLng(startLat, startLng);
            const endLatLng = new google.maps.LatLng(endLat, endLng);

            return new Promise((resolve) => {
                directionsService.route({
                    origin: startLatLng,
                    destination: endLatLng,
                    travelMode: google.maps.TravelMode.DRIVING
                }, (response, status) => {
                    if (status === google.maps.DirectionsStatus.OK) {
                        const route = response.routes[0];
                        const leg = route.legs[0];
                        
                        const distanceKm = leg.distance.value / 1000.0;
                        const durationMin = leg.duration.value / 60.0;

                        // Clear route lines
                        this.polylines.forEach(p => p.setMap(null));
                        this.polylines = [];

                        // Draw Google routing path
                        const routeLine = new google.maps.Polyline({
                            path: route.overview_path,
                            strokeColor: '#6366f1',
                            strokeOpacity: 0.85,
                            strokeWeight: 6
                        });
                        routeLine.setMap(this.map);
                        this.polylines.push(routeLine);

                        // Fit bounds
                        this.map.fitBounds(route.bounds);

                        // Format steps
                        const steps = leg.steps.map(step => ({
                            instruction: step.instructions,
                            distance: step.distance.value
                        }));

                        resolve({
                            distance_km: distanceKm,
                            duration_min: durationMin,
                            steps: steps
                        });
                    } else {
                        console.warn("Google Directions Service failed. Status:", status, "Falling back to straight line.");
                        resolve(this.drawDottedFallbackRoute(startLat, startLng, endLat, endLng));
                    }
                });
            });
        } else {
            console.warn("Google Maps DirectionsService not available. Using fallback.");
            return this.drawDottedFallbackRoute(startLat, startLng, endLat, endLng);
        }
    },

    drawDottedFallbackRoute(startLat, startLng, endLat, endLng) {
        if (this.map) {
            this.polylines.forEach(p => p.setMap(null));
            this.polylines = [];
            
            const path = new google.maps.Polyline({
                path: [
                    { lat: startLat, lng: startLng },
                    { lat: endLat, lng: endLng }
                ],
                strokeColor: '#6366f1',
                strokeOpacity: 0,
                strokeWeight: 3,
                icons: [{
                    icon: {
                        path: 'M 0,-1 0,1',
                        strokeOpacity: 0.6,
                        scale: 2
                    },
                    offset: '0',
                    repeat: '10px'
                }]
            });
            path.setMap(this.map);
            this.polylines.push(path);

            const bounds = new google.maps.LatLngBounds();
            bounds.extend({ lat: startLat, lng: startLng });
            bounds.extend({ lat: endLat, lng: endLng });
            this.map.fitBounds(bounds);
        }

        const straightDist = this.haversineDistance(startLat, startLng, endLat, endLng);
        return {
            distance_km: straightDist * 1.25,
            duration_min: straightDist * 2.0,
            steps: [
                { instruction: "Proceed from pickup to dropoff via general route.", distance: straightDist * 1000 }
            ],
            isFallback: true
        };
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
        if (!this.map) {
            this.pendingDriverMarker = { lat, lng };
            return;
        }

        const latLng = new google.maps.LatLng(lat, lng);
        if (this.driverMarker) {
            this.driverMarker.setPosition(latLng);
        } else {
            // Elegant pulsing driver marker
            const html = `<div class="driver-marker-pulse" style="
                width: 20px;
                height: 20px;
                background: #3b82f6;
                border: 3px solid #ffffff;
                border-radius: 50%;
                box-shadow: 0 0 10px rgba(59, 130, 246, 0.8);
            "></div>`;

            this.driverMarker = new HTMLMarker(latLng, this.map, html);
            
            const infoWindow = new google.maps.InfoWindow({
                content: '<div style="color:#111827; font-size:11px; font-family:\'Inter\';"><b>Driver is here</b></div>'
            });
            google.maps.event.addListener(this.driverMarker, 'click', () => {
                infoWindow.setPosition(this.driverMarker.getPosition());
                infoWindow.open(this.map);
            });
            
            // Open popup automatically
            setTimeout(() => {
                infoWindow.setPosition(this.driverMarker.getPosition());
                infoWindow.open(this.map);
            }, 150);
        }
    },

    clearDriverMarker() {
        if (this.driverMarker) {
            this.driverMarker.setMap(null);
            this.driverMarker = null;
        }
        this.pendingDriverMarker = null;
    }
};

// Define global callback function fired once Google Maps finishes loading
window.initGoogleMapsCallback = function() {
    console.log("Google Maps API loaded dynamically.");
    CampusMap.processInitQueue();
};
