// CAMPUSRIDE API WRAPPER SERVICE
const API = {
    baseUrl: '',

    getCsrfToken() {
        let cookieValue = null;
        if (document.cookie && document.cookie !== '') {
            const cookies = document.cookie.split(';');
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, 10) === 'csrftoken=') {
                    cookieValue = decodeURIComponent(cookie.substring(10));
                    break;
                }
            }
        }
        if (cookieValue) {
            return cookieValue;
        }
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (meta) {
            return meta.getAttribute('content');
        }
        return null;
    },

    async request(url, options = {}) {
        const csrftoken = this.getCsrfToken();
        options.headers = {
            'Content-Type': 'application/json',
            ...(csrftoken ? { 'X-CSRFToken': csrftoken } : {}),
            ...(options.headers || {})
        };
        
        // Credentials include matches cookies for sessions
        options.credentials = 'include';

        try {
            const response = await fetch(`${this.baseUrl}${url}`, options);
            
            if (response.status === 401) {
                // Not authenticated, handle gracefully in application
                if (!url.includes('/api/me/')) {
                    console.warn("Session expired or unauthenticated.");
                }
            }

            const data = await response.json();
            
            if (!response.ok) {
                return { error: data.error || data.detail || 'API request failed', status: response.status };
            }
            
            return { data, status: response.status };
        } catch (error) {
            console.error(`API Error on ${url}:`, error);
            return { error: 'Network communication error. Please check if backend is running.' };
        }
    },

    // 1. Auth Operations
    async me() {
        return this.request('/api/me/');
    },

    async login(username, password) {
        return this.request('/api/login/', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    async register(username, email, password, phone, university, gender, emergency_contact, role) {
        return this.request('/api/register/', {
            method: 'POST',
            body: JSON.stringify({ username, email, password, phone, university, gender, emergency_contact, role })
        });
    },

    async logout() {
        return this.request('/api/logout/', { method: 'POST' });
    },

    async verifyProfile(verificationDoc) {
        return this.request('/api/verify-profile/', {
            method: 'POST',
            body: JSON.stringify({ verification_doc: verificationDoc })
        });
    },

    // 2. Rides Operations
    async getRides(filters = {}) {
        const queryParams = new URLSearchParams();
        if (filters.pickup) queryParams.append('pickup', filters.pickup);
        if (filters.dropoff) queryParams.append('dropoff', filters.dropoff);
        if (filters.date) queryParams.append('date', filters.date);
        if (filters.seats) queryParams.append('seats', filters.seats);
        
        const queryString = queryParams.toString();
        return this.request(`/api/rides/${queryString ? '?' + queryString : ''}`);
    },

    async getRideDetail(rideId) {
        return this.request(`/api/rides/${rideId}/`);
    },

    async createRide(rideData) {
        return this.request('/api/rides/', {
            method: 'POST',
            body: JSON.stringify(rideData)
        });
    },

    async predictPrice(pricingData) {
        return this.request('/api/rides/price-predict/', {
            method: 'POST',
            body: JSON.stringify(pricingData)
        });
    },

    async getMatchedRides(matchingParams) {
        const queryParams = new URLSearchParams();
        queryParams.append('pickup_lat', matchingParams.pickup_lat);
        queryParams.append('pickup_lng', matchingParams.pickup_lng);
        queryParams.append('dropoff_lat', matchingParams.dropoff_lat);
        queryParams.append('dropoff_lng', matchingParams.dropoff_lng);
        if (matchingParams.date) queryParams.append('date', matchingParams.date);
        
        return this.request(`/api/rides/matching/?${queryParams.toString()}`);
    },

    // 3. Bookings Operations
    async getBookings() {
        return this.request('/api/bookings/');
    },

    async createBooking(rideId, seatsBooked = 1) {
        return this.request('/api/bookings/', {
            method: 'POST',
            body: JSON.stringify({ ride_id: rideId, seats_booked: seatsBooked })
        });
    },

    async bookingAction(bookingId, action) {
        return this.request(`/api/bookings/${bookingId}/action/`, {
            method: 'POST',
            body: JSON.stringify({ action })
        });
    },

    // 4. Chat Messages Operations
    async getMessages(otherUserId, rideId = null, sinceId = null) {
        const queryParams = new URLSearchParams();
        queryParams.append('user_id', otherUserId);
        if (rideId) queryParams.append('ride_id', rideId);
        if (sinceId) queryParams.append('since_id', sinceId);
        
        return this.request(`/api/chat/messages/?${queryParams.toString()}`);
    },

    async sendMessage(receiverId, content, rideId = null) {
        return this.request('/api/chat/messages/', {
            method: 'POST',
            body: JSON.stringify({ receiver_id: receiverId, content, ride_id: rideId })
        });
    },

    async getConversations() {
        return this.request('/api/chat/conversations/');
    },

    // 5. Notifications Operations
    async getNotifications() {
        return this.request('/api/notifications/');
    },

    async markNotificationsRead(id = null) {
        return this.request('/api/notifications/mark-read/', {
            method: 'POST',
            body: JSON.stringify(id ? { id } : {})
        });
    },

    // 6. Safety & Moderation Operations
    async reviewRide(rideId, revieweeId, rating, comment) {
        return this.request('/api/safety/review/', {
            method: 'POST',
            body: JSON.stringify({ ride_id: rideId, reviewee_id: revieweeId, rating, comment })
        });
    },

    async reportUser(reportedUserId, reason, details, rideId = null) {
        return this.request('/api/safety/report/', {
            method: 'POST',
            body: JSON.stringify({ reported_user_id: reportedUserId, reason, details, ride_id: rideId })
        });
    },

    async blockUser(blockedUserId) {
        return this.request('/api/safety/block/', {
            method: 'POST',
            body: JSON.stringify({ blocked_user_id: blockedUserId })
        });
    },

    async triggerSOS(rideId, lat, lng) {
        return this.request('/api/safety/sos/', {
            method: 'POST',
            body: JSON.stringify({ ride_id: rideId, lat, lng })
        });
    },

    async getSOSAlerts() {
        return this.request('/api/safety/sos/admin_list/');
    },

    async resolveSOS(eventId) {
        return this.request(`/api/safety/sos/${eventId}/resolve/`, {
            method: 'POST'
        });
    },

    // 7. QR/PIN Ride Verification Operations
    async verifyBookingPin(bookingId, pin) {
        return this.request(`/api/bookings/${bookingId}/verify-pin/`, {
            method: 'POST',
            body: JSON.stringify({ pin })
        });
    },

    async verifyBookingQr(token) {
        return this.request('/api/bookings/verify-qr/', {
            method: 'POST',
            body: JSON.stringify({ token })
        });
    },

    async completeBookingRide(bookingId) {
        return this.request(`/api/bookings/${bookingId}/complete/`, {
            method: 'POST'
        });
    }
};
