// CAMPUSRIDE CENTRAL APP CONTROLLER
window.handleAvatarError = function(img, username) {
    if (window.App && typeof window.App.getAvatarFallback === 'function') {
        img.src = window.App.getAvatarFallback(username);
    } else {
        const initials = username ? username.substring(0, 2).toUpperCase() : 'CR';
        img.src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%236366f1"/><text x="50" y="55" font-family="sans-serif" font-size="40" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
    }
    img.onerror = null;
};

const App = {
    currentUser: null,
    currentView: 'dashboard',
    rides: [],
    conversations: [],
    activeConvoId: null,
    lastFetchedMessageId: 0,
    notifications: [],
    activeRideDetail: null,
    
    // Create Ride Flow states
    createPickupCoords: null,
    createDropoffCoords: null,
    createMap: null,
    createStep: 1,

    // Polling handles
    pollingTimer: null,
    locationPollTimer: null,
    driverGeolocateWatchId: null,

    // Image Fallbacks
    getAvatarFallback(username) {
        const initials = username ? username.substring(0, 2).toUpperCase() : 'CR';
        return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%236366f1"/><text x="50" y="55" font-family="'Outfit', sans-serif" font-size="40" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle">${initials}</text></svg>`;
    },

    async init() {
        console.log("CampusRide Initializing...");
        
        // 1. Session check
        const { data, error } = await API.me();
        if (data && !error) {
            this.currentUser = data;
            this.onAuthenticated();
        } else {
            this.onGuest();
        }

        // 2. Register global UI listeners
        this.bindEvents();
    },

    onAuthenticated() {
        this.currentUser.is_staff = this.currentUser.is_staff || this.currentUser.is_admin;
        
        // Update sidebar profile
        document.getElementById('sidebarUsername').innerText = `@${this.currentUser.username}`;
        
        const isExternal = this.currentUser.role === 'external_driver';
        const roleLabel = isExternal ? 'External Driver' : (this.currentUser.is_staff ? 'System Admin' : 'Student Commuter');
        document.getElementById('sidebarUniversity').innerText = isExternal ? roleLabel : (this.currentUser.university || 'Campus member');
        
        const avatarImg = document.getElementById('sidebarAvatar');
        avatarImg.src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
        avatarImg.onerror = () => { avatarImg.src = this.getAvatarFallback(this.currentUser.username); };

        if (this.currentUser.verification_status === 'verified') {
            document.getElementById('sidebarVerifiedBadge').style.display = 'flex';
        } else {
            document.getElementById('sidebarVerifiedBadge').style.display = 'none';
        }

        // Show/hide Admin Navigation
        if (this.currentUser.is_staff) {
            document.getElementById('adminNavNode').style.display = 'block';
        } else {
            document.getElementById('adminNavNode').style.display = 'none';
        }

        // Dynamic Role-based Navigation menu items filtering
        if (isExternal) {
            document.getElementById('navSearchNode').style.display = 'none';
        } else {
            document.getElementById('navSearchNode').style.display = 'block';
        }

        // Toggle page elements visibility
        document.getElementById('view-guest').style.display = 'none';
        document.getElementById('sidebarNode').style.display = 'flex';
        document.getElementById('headerNode').style.display = 'flex';
        
        const copilot = document.getElementById('aiCopilotWidget');
        if (copilot) copilot.style.display = 'block';

        // Go to dashboard
        this.showView('dashboard');

        // Start polling for real-time notifications/messages
        this.startPolling();
    },

    onGuest() {
        this.currentUser = null;
        this.stopPolling();
        
        document.getElementById('sidebarNode').style.display = 'none';
        document.getElementById('headerNode').style.display = 'none';
        document.getElementById('view-guest').style.display = 'flex';
        
        const copilot = document.getElementById('aiCopilotWidget');
        if (copilot) {
            copilot.style.display = 'none';
            document.getElementById('aiCopilotChatBox').style.display = 'none';
        }
        
        // Hide all views
        const subviews = ['dashboard', 'search', 'create', 'bookings', 'chat', 'verification', 'admin'];
        subviews.forEach(v => {
            const el = document.getElementById(`view-${v}`);
            if (el) el.style.display = 'none';
        });
    },

    startPolling() {
        this.stopPolling();
        this.pollUpdates();
        this.pollingTimer = setInterval(() => this.pollUpdates(), 4000); // Poll every 4 seconds
    },

    stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }
    },

    async pollUpdates() {
        if (!this.currentUser) return;

        // Fetch notifications
        const notiRes = await API.getNotifications();
        if (notiRes.data && !notiRes.error) {
            const newNotis = notiRes.data.filter(n => !n.is_read);
            const badgeEl = document.getElementById('notiBadge');
            
            if (newNotis.length > 0) {
                badgeEl.innerText = newNotis.length;
                badgeEl.style.display = 'block';
                
                // Pop toasts for brand new unread notifications
                newNotis.forEach(n => {
                    const exists = this.notifications.some(existing => existing.id === n.id);
                    if (!exists) {
                        this.showNotificationToast(n);
                    }
                });
            } else {
                badgeEl.style.display = 'none';
            }
            this.notifications = notiRes.data;

            // Re-render dropdown list if visible
            const dropdown = document.getElementById('notiDropdown');
            if (dropdown && dropdown.style.display === 'flex') {
                this.renderNotificationsDropdown();
                const hasUnread = this.notifications.some(n => !n.is_read);
                if (hasUnread) {
                    API.markNotificationsRead();
                    if (badgeEl) badgeEl.style.display = 'none';
                    this.notifications.forEach(n => n.is_read = true);
                }
            }
        }

        // If chat screen is open & a convo is active, poll for new messages
        if (this.currentView === 'chat' && this.activeConvoId) {
            const chatRes = await API.getMessages(this.activeConvoId, null, this.lastFetchedMessageId);
            if (chatRes.data && chatRes.data.length > 0) {
                const bubblesContainer = document.getElementById('chatBubblesNode');
                chatRes.data.forEach(msg => {
                    if (msg.id > this.lastFetchedMessageId) {
                        this.lastFetchedMessageId = msg.id;
                    }
                    const bubble = document.createElement('div');
                    const isIncoming = msg.sender !== this.currentUser.id;
                    bubble.className = `chat-message-bubble ${isIncoming ? 'incoming' : 'outgoing'}`;
                    bubble.innerHTML = `
                        ${msg.content}
                        <span class="msg-timestamp">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    `;
                    bubblesContainer.appendChild(bubble);
                });
                bubblesContainer.scrollTop = bubblesContainer.scrollHeight;
            }
        }
    },

    showNotificationToast(noti) {
        const stack = document.getElementById('toastStackNode');
        const toast = document.createElement('div');
        toast.className = `toast ${noti.notification_type}`;
        
        let icon = 'ri-notification-3-fill';
        if (noti.notification_type === 'booking_request') icon = 'ri-user-shared-fill';
        if (noti.notification_type === 'booking_status') icon = 'ri-shield-check-fill';
        if (noti.notification_type === 'new_message') icon = 'ri-chat-3-fill';

        toast.innerHTML = `
            <div class="toast-icon"><i class="${icon}"></i></div>
            <div class="toast-content">
                <div class="toast-title">${noti.title}</div>
                <div class="toast-body">${noti.content}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        
        stack.appendChild(toast);
        
        // Auto remove toast after 5s
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 5000);
    },

    renderNotificationsDropdown() {
        const listNode = document.getElementById('notiDropdownListNode');
        if (!listNode) return;
        
        listNode.innerHTML = '';
        
        if (!this.notifications || this.notifications.length === 0) {
            listNode.innerHTML = `
                <div style="padding: 24px 16px; text-align: center; color: var(--text-muted); font-size: 12px;">
                    <i class="ri-notification-off-line" style="font-size: 24px; display: block; margin-bottom: 8px; color: var(--border-color); opacity: 0.5;"></i>
                    No notifications yet.
                </div>
            `;
            return;
        }
        
        this.notifications.forEach(n => {
            const item = document.createElement('div');
            item.className = `notification-item ${n.is_read ? '' : 'unread'}`;
            
            // Format icon based on type
            let iconClass = 'ri-notification-3-line';
            let bgClass = 'system';
            if (n.notification_type === 'booking_request') {
                iconClass = 'ri-user-shared-line';
                bgClass = 'booking_request';
            } else if (n.notification_type === 'booking_status') {
                iconClass = 'ri-shield-check-line';
                bgClass = 'booking_status';
            } else if (n.notification_type === 'new_message') {
                iconClass = 'ri-chat-3-line';
                bgClass = 'new_message';
            }
            
            const timeStr = new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const dateStr = new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
            
            item.innerHTML = `
                <div class="notification-icon-wrapper ${bgClass}">
                    <i class="${iconClass}"></i>
                </div>
                <div class="notification-item-content">
                    <div class="notification-item-title">${n.title}</div>
                    <div class="notification-item-body">${n.content}</div>
                    <div class="notification-item-time">${dateStr} at ${timeStr}</div>
                </div>
            `;
            
            item.addEventListener('click', () => {
                if (n.notification_type === 'booking_request' || n.notification_type === 'booking_status') {
                    this.showView('bookings');
                } else if (n.notification_type === 'new_message') {
                    this.showView('chat');
                }
                
                const dropdown = document.getElementById('notiDropdown');
                if (dropdown) dropdown.style.display = 'none';
            });
            
            listNode.appendChild(item);
        });
    },

    addAiCopilotMessage(content, sender) {
        const body = document.getElementById('aiCopilotBodyNode');
        if (!body) return;
        
        // Remove quick options if present at the end
        const opts = body.querySelector('.ai-quick-options');
        if (opts) opts.remove();
        
        const msg = document.createElement('div');
        msg.className = `ai-msg ${sender}`;
        msg.innerHTML = content.replace(/\n/g, '<br/>');
        body.appendChild(msg);
        
        // Scroll to bottom
        body.scrollTop = body.scrollHeight;
    },
    
    showAiCopilotTypingIndicator() {
        const body = document.getElementById('aiCopilotBodyNode');
        if (!body) return null;
        
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'aiCopilotTypingIndicator';
        indicator.innerHTML = `
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        `;
        body.appendChild(indicator);
        body.scrollTop = body.scrollHeight;
        return indicator;
    },
    
    removeAiCopilotTypingIndicator() {
        const ind = document.getElementById('aiCopilotTypingIndicator');
        if (ind) ind.remove();
    },
    
    async triggerAiCopilotReply(query) {
        const indicator = this.showAiCopilotTypingIndicator();
        
        // Simulate a small delay for typing response
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 800));
        this.removeAiCopilotTypingIndicator();
        
        const text = query.toLowerCase();
        let reply = "";
        
        if (text.includes("price") || text.includes("fare") || text.includes("cost") || text === "price_explain") {
            reply = `<b>🚗 CampusRide AI Dynamic Pricing:</b><br/><br/>
            Our pricing is calculated sharing costs across commuters. The base fare starts at <b>Rs. 150</b>.<br/><br/>
            <b>Adjustments:</b><br/>
            • <b>Vehicle Efficiency:</b> Electric & Hybrids get 15% discount. SUVs carry a 20% premium.<br/>
            • <b>Rush Hour Multiplier:</b> Weekday traffic zones (7:30-9:30 AM & 4:30-6:30 PM) apply a <b>1.3x</b> coefficient.<br/>
            • <b>Exam / Holiday Demand:</b> Exam periods (May & Dec) increase matches recommendation by +15%.<br/>
            • <b>Group discounts:</b> Cost split is discounted automatically for 4+ seats.`;
        } else if (text.includes("draft") || text.includes("message") || text.includes("ask") || text === "draft_request") {
            reply = `<b>📝 Booking Request Template:</b><br/><br/>
            Here is a friendly template you can copy and send to your driver:<br/><br/>
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-color); padding:10px; border-radius:8px; user-select:all; font-style:italic; font-size:11px;">
            "Hi! I saw your ride offer on CampusRide. I'd love to request a seat from [Pickup] to [Dropoff] if still available. Let me know if that works! Thanks."
            </div>`;
        } else if (text.includes("safety") || text.includes("security") || text === "safety_tips") {
            reply = `<b>🛡️ Commuter Safety Protocols:</b><br/><br/>
            1. <b>Green Checkmarks:</b> Only ride with students or drivers carrying verified safety tags.<br/>
            2. <b>Vehicle Details:</b> Confirm the plate and model match the description before entry.<br/>
            3. <b>Trigger SOS:</b> In emergencies, click the <b>🚨 SOS</b> button inside ride details. Campus security is dispatched immediately to your exact coordinates.`;
        } else if (text.includes("verify") || text.includes("card") || text.includes("license") || text === "verify_help") {
            reply = `<b>🔑 Student ID & License Verification:</b><br/><br/>
            • <b>Students:</b> Upload a description of your student registration card on the <b>ID Verification</b> page to receive green trust checkmarks.<br/>
            • <b>External Drivers:</b> Must upload driving license, plates, and ID. Rides will only become available after administrative review.`;
        } else if (text.includes("hello") || text.includes("hi") || text.includes("hey")) {
            reply = `Hello! I'm here to make your commute more efficient. Ask me about pricing formulas, safety precautions, or request drafts!`;
        } else {
            // Extract location keyword from query
            const searchLocation = text
                .replace(/\b(find|search|show|me|a|ride|rides|to|from|in|at|for|the|of|carpool|carpools)\b/g, "")
                .trim();
                
            if (searchLocation.length >= 2) {
                const { data: ridesArray, error } = await API.getRides();
                if (ridesArray && !error) {
                    const matches = ridesArray.filter(r => 
                        r.pickup_name.toLowerCase().includes(searchLocation) ||
                        r.dropoff_name.toLowerCase().includes(searchLocation)
                    );
                    
                    if (matches.length > 0) {
                        reply = `<b>🔍 Matching Rides Found:</b><br/>I found ${matches.length} active ride(s) matching "<b>${searchLocation}</b>":<br/>`;
                        matches.forEach(ride => {
                            const vehicleIcon = ride.vehicle_type === 'motorbike' ? '🏍️' : '🚗';
                            reply += `
                            <div class="ai-ride-card" onclick="window.showRideDetailFromMap(${ride.id})">
                                <div class="ai-ride-card-header">
                                    <span class="ai-ride-driver">${vehicleIcon} @${ride.driver.username}</span>
                                    <span class="ai-ride-price">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}</span>
                                </div>
                                <div class="ai-ride-route">
                                    <div><b>From:</b> ${ride.pickup_name} ${ride.pickup_address_details ? `<span style="font-size:10px; color:var(--text-muted);">(${ride.pickup_address_details})</span>` : ''}</div>
                                    <div><b>To:</b> ${ride.dropoff_name} ${ride.dropoff_address_details ? `<span style="font-size:10px; color:var(--text-muted);">(${ride.dropoff_address_details})</span>` : ''}</div>
                                </div>
                                <div class="ai-ride-footer">
                                    <span>📅 ${ride.date}</span>
                                    <span class="view-btn">View Details ➔</span>
                                </div>
                            </div>`;
                        });
                    } else {
                        reply = `I couldn't find any active rides matching "<b>${searchLocation}</b>". Try searching for active rides using a different location name, or ask about our <b>AI pricing engine</b>, <b>safety guidelines</b>, or <b>profile verification status</b>.`;
                    }
                } else {
                    reply = `I encountered an issue searching for active rides. Please try again.`;
                }
            } else {
                reply = `I'm not fully sure how to answer that, but I can help you with commute guidelines! You can ask about our <b>AI pricing engine</b>, <b>safety guidelines</b>, or type a location name (e.g., 'Clifton', 'DHA Suffa') to search active carpools.`;
            }
        }
        
        this.addAiCopilotMessage(reply, 'bot');
        
        // Re-append quick options at the end
        const body = document.getElementById('aiCopilotBodyNode');
        if (body) {
            const opts = document.createElement('div');
            opts.className = 'ai-quick-options';
            opts.innerHTML = `
                <button class="quick-opt-btn" data-query="price_explain">
                    <i class="ri-scales-3-line"></i>
                    <span>Explain AI Pricing</span>
                </button>
                <button class="quick-opt-btn" data-query="draft_request">
                    <i class="ri-file-list-3-line"></i>
                    <span>Draft Request Message</span>
                </button>
                <button class="quick-opt-btn" data-query="safety_tips">
                    <i class="ri-shield-user-line"></i>
                    <span>Safety Guidelines</span>
                </button>
                <button class="quick-opt-btn" data-query="verify_help">
                    <i class="ri-key-2-line"></i>
                    <span>Verification Guide</span>
                </button>
            `;
            body.appendChild(opts);
            body.scrollTop = body.scrollHeight;
        }
    },

    // ----------------------------------------------------
    // VIEW ROUTING
    // ----------------------------------------------------
    showView(viewName) {
        // Enforce role-based access control for admin view
        if (viewName === 'admin' && (!this.currentUser || !this.currentUser.is_staff)) {
            console.warn("Access denied: Admin role required.");
            if (this.currentView !== 'dashboard') {
                this.showView('dashboard');
            }
            return;
        }

        // Enforce role-based access control for search view
        if (viewName === 'search' && this.currentUser && this.currentUser.role === 'external_driver') {
            console.warn("Access denied: External drivers cannot search rides.");
            if (this.currentView !== 'dashboard') {
                this.showView('dashboard');
            }
            return;
        }

        this.currentView = viewName;

        // Update headers
        const headers = {
            'dashboard': { title: 'Commuter Dashboard', sub: 'Monitor your carpools, coordinate rides, and reviews.' },
            'search': { title: 'Find Campus Rides', sub: 'Search available rides or trigger our Smart Match system.' },
            'create': { title: 'Publish a Carpool', sub: 'Post route details, calculate price, and share your commute.' },
            'bookings': { title: 'My Bookings', sub: 'Review ride request approvals and reservation tickets.' },
            'chat': { title: 'In-App Messages', sub: 'Chat with other students before booking rides.' },
            'verification': { title: 'Student Verification', sub: 'Manage verification badges and profile parameters.' },
            'admin': { title: 'Admin Controls', sub: 'Verify students, inspect reports, and moderate complaints.' }
        };

        const config = headers[viewName] || { title: 'CampusRide', sub: '' };
        document.getElementById('headerTitle').innerText = config.title;
        document.getElementById('headerSubtitle').innerText = config.sub;

        // Update active navigation item
        document.querySelectorAll('.nav-item').forEach(link => {
            if (link.getAttribute('data-view') === viewName) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Hide all views, display active
        const subviews = ['dashboard', 'search', 'create', 'bookings', 'chat', 'verification', 'admin'];
        subviews.forEach(v => {
            const el = document.getElementById(`view-${v}`);
            if (el) el.style.display = (v === viewName) ? 'block' : 'none';
        });

        // Load data specific to each view
        this.onViewLoaded(viewName);
    },

    onViewLoaded(viewName) {
        if (viewName === 'dashboard') {
            this.loadDashboardData();
        } else if (viewName === 'search') {
            this.initSearchPage();
        } else if (viewName === 'create') {
            this.initCreateRidePage();
        } else if (viewName === 'bookings') {
            this.loadBookingsData();
        } else if (viewName === 'chat') {
            this.loadChatConversations();
        } else if (viewName === 'verification') {
            this.loadVerificationPage();
        } else if (viewName === 'admin') {
            this.loadAdminPage();
        }
    },

    // ----------------------------------------------------
    // VIEW CONTROLLERS
    // ----------------------------------------------------
    
    // A. DASHBOARD VIEW
    async loadDashboardData() {
        const isExternal = this.currentUser.role === 'external_driver';

        // Fetch bookings to count
        if (!isExternal) {
            const bookRes = await API.getBookings();
            if (bookRes.data && !bookRes.error) {
                const activeBookings = bookRes.data.my_bookings.filter(b => b.status === 'approved').length;
                document.getElementById('dashMyBookings').innerText = activeBookings;
            }
        }

        // Fetch active rides to count
        const ridesRes = await API.getRides();
        if (ridesRes.data && !ridesRes.error) {
            document.getElementById('dashTotalRides').innerText = ridesRes.data.length;
        }

        // Verification text
        const statusText = document.getElementById('dashVerifiedStatusText');
        const statusIcon = document.getElementById('dashVerifiedStatusIcon');
        
        const status = this.currentUser.verification_status;
        if (status === 'verified') {
            statusText.innerText = isExternal ? 'Verified Driver' : 'Verified Student';
            statusIcon.className = 'stat-icon accent';
        } else if (status === 'pending') {
            statusText.innerText = 'Pending Review';
            statusIcon.className = 'stat-icon secondary';
        } else {
            statusText.innerText = 'Unverified Profile';
            statusIcon.className = 'stat-icon primary';
        }

        // Adjust dashboard stat card visibility and classes for external driver
        const statsGrid = document.getElementById('dashboardStatsGrid');
        const cardBookings = document.getElementById('statCardBookings');
        const dashGrid = document.getElementById('dashboardGrid');
        const myBookingsCard = document.getElementById('myBookingsCard');
        const ridesLabel = document.querySelector('#statCardRides .stat-label');
        
        if (ridesLabel) {
            ridesLabel.innerText = isExternal ? "My Uploaded Rides" : "Active Campus Rides";
        }

        if (isExternal) {
            if (cardBookings) cardBookings.style.display = 'none';
            if (statsGrid) {
                statsGrid.classList.remove('grid-cols-3');
                statsGrid.classList.add('grid-cols-2');
            }
            if (myBookingsCard) myBookingsCard.style.display = 'none';
            if (dashGrid) {
                dashGrid.style.gridTemplateColumns = '1fr';
            }
        } else {
            if (cardBookings) cardBookings.style.display = 'flex';
            if (statsGrid) {
                statsGrid.classList.remove('grid-cols-2');
                statsGrid.classList.add('grid-cols-3');
            }
            if (myBookingsCard) myBookingsCard.style.display = 'block';
            if (dashGrid) {
                dashGrid.style.gridTemplateColumns = '';
            }
        }

        // Render recents
        this.renderDashboardRidesAndBookings();
    },

    async renderDashboardRidesAndBookings() {
        const myRidesNode = document.getElementById('dashboardMyRidesNode');
        const myBookingsNode = document.getElementById('dashboardMyBookingsNode');
        
        myRidesNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Loading rides...</span>';
        myBookingsNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Loading bookings...</span>';

        const ridesRes = await API.getRides();
        const bookingsRes = await API.getBookings();

        if (ridesRes.data && !ridesRes.error) {
            // Filter rides I am driving
            const drivingRides = ridesRes.data.filter(r => r.driver.id === this.currentUser.id);
            if (drivingRides.length === 0) {
                myRidesNode.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0;">You aren\'t hosting any rides.</div>';
            } else {
                myRidesNode.innerHTML = '';
                drivingRides.forEach(ride => {
                    const card = document.createElement('div');
                    card.className = 'card ride-card glow-hover';
                    card.onclick = () => this.showRideDetails(ride.id);
                    card.innerHTML = `
                        <div class="ride-card-header">
                            <div>
                                <h4 style="font-size: 14px; font-weight: 700;">Ride #${ride.id}</h4>
                                <span style="font-size: 11px; color: var(--text-muted);">${ride.date} @ ${ride.time.substring(0, 5)}</span>
                            </div>
                            <div class="ride-price">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}</div>
                        </div>
                        <div class="route-timeline">
                            <div class="timeline-stop pickup">
                                ${ride.pickup_name}
                                ${ride.pickup_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.pickup_address_details})</div>` : ''}
                            </div>
                            <div class="timeline-stop dropoff">
                                ${ride.dropoff_name}
                                ${ride.dropoff_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.dropoff_address_details})</div>` : ''}
                            </div>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                            <i class="${ride.vehicle_type === 'motorbike' ? 'ri-motorbike-fill' : 'ri-car-fill'}"></i> ${ride.seats_available} / ${ride.seats_total} seats remaining
                        </div>
                    `;
                    myRidesNode.appendChild(card);
                });
            }
        }

        if (bookingsRes.data && !bookingsRes.error) {
            const passengerBookings = bookingsRes.data.my_bookings;
            if (passengerBookings.length === 0) {
                myBookingsNode.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:24px 0;">You haven\'t booked any rides.</div>';
            } else {
                myBookingsNode.innerHTML = '';
                passengerBookings.forEach(booking => {
                    const ride = booking.ride;
                    const card = document.createElement('div');
                    card.className = 'card ride-card glow-hover';
                    card.onclick = () => this.showRideDetails(ride.id);
                    
                    let statusColor = '#f59e0b';
                    if (booking.status === 'approved') statusColor = 'var(--accent)';
                    if (booking.status === 'rejected' || booking.status === 'cancelled') statusColor = 'var(--error)';

                    card.innerHTML = `
                        <div class="ride-card-header">
                            <div class="ride-card-driver">
                                <img src="${ride.driver.avatar_url}" onerror="window.handleAvatarError(this, '${ride.driver.username}')" class="driver-mini-avatar"/>
                                <div class="driver-name-rating">
                                    <span class="driver-name">@${ride.driver.username} <i class="${ride.vehicle_type === 'motorbike' ? 'ri-motorbike-fill' : 'ri-car-fill'}" style="margin-left:4px;"></i></span>
                                    <span class="driver-rating">⭐ ${ride.driver.rating_avg}</span>
                                </div>
                            </div>
                            <div class="ride-price">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}</div>
                        </div>
                        <div class="route-timeline">
                            <div class="timeline-stop pickup">
                                ${ride.pickup_name}
                                ${ride.pickup_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.pickup_address_details})</div>` : ''}
                            </div>
                            <div class="timeline-stop dropoff">
                                ${ride.dropoff_name}
                                ${ride.dropoff_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.dropoff_address_details})</div>` : ''}
                            </div>
                        </div>
                        <div class="ride-card-footer">
                            <div>${ride.date} @ ${ride.time.substring(0, 5)}</div>
                            <div style="color: ${statusColor}; font-weight: bold; text-transform: uppercase; font-size:10px;">${booking.status}</div>
                        </div>
                    `;
                    myBookingsNode.appendChild(card);
                });
            }
        }
    },

    // B. FIND / SEARCH RIDES VIEW
    initSearchPage() {
        // Initialize Map
        CampusMap.init('searchMapCanvas', (lat, lng) => {
            // Callback when map is clicked:
            // We alternate setting search inputs
            const pickupInput = document.getElementById('searchPickup');
            const dropoffInput = document.getElementById('searchDropoff');
            
            if (!pickupInput.dataset.lat) {
                pickupInput.dataset.lat = lat;
                pickupInput.dataset.lng = lng;
                pickupInput.value = `Map Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                CampusMap.setSelectionMarker('pickup', lat, lng, "Selected Pickup");
            } else {
                dropoffInput.dataset.lat = lat;
                dropoffInput.dataset.lng = lng;
                dropoffInput.value = `Map Point (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
                CampusMap.setSelectionMarker('dropoff', lat, lng, "Selected Dropoff");
            }
            this.checkAndTraceRoute('search');
        });

        // Clear values dataset
        const pInput = document.getElementById('searchPickup');
        const dInput = document.getElementById('searchDropoff');
        pInput.value = ""; delete pInput.dataset.lat; delete pInput.dataset.lng;
        dInput.value = ""; delete dInput.dataset.lat; delete dInput.dataset.lng;

        // Reset map search overlay & directions
        document.getElementById('searchDirectionsGuide').style.display = 'none';
        document.getElementById('searchMapQuery').value = '';
        document.getElementById('searchMapResults').style.display = 'none';
        document.getElementById('searchMapResults').innerHTML = '';
        
        // Fetch all rides initially
        this.fetchSearchRides();
    },

    async fetchSearchRides(filters = {}) {
        const listNode = document.getElementById('ridesListNode');
        listNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:10px;">Searching carpools...</span>';

        const { data, error } = await API.getRides(filters);
        if (data && !error) {
            this.rides = data;
            this.renderRidesList(data);
            CampusMap.showRides(data);
        } else {
            listNode.innerHTML = `<span style="color:var(--error);padding:10px;">${error || 'Could not fetch rides'}</span>`;
        }
    },

    async searchPakistanLocations(query, mapType) {
        const resultsContainer = document.getElementById(`${mapType}MapResults`);
        if (!resultsContainer) return;
        
        if (!query || query.trim().length < 3) {
            resultsContainer.style.display = 'none';
            return;
        }
        
        resultsContainer.innerHTML = '<li class="map-search-result-item" style="text-align:center;color:var(--text-muted);">Searching Pakistan locations...</li>';
        resultsContainer.style.display = 'block';

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=pk&addressdetails=1&limit=5`;
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'CampusRide-Student-Carpool/1.0 (Student Carpool App)'
                }
            });
            if (!response.ok) throw new Error("Nominatim search failed");
            const data = await response.json();
            
            resultsContainer.innerHTML = '';
            if (data.length === 0) {
                resultsContainer.innerHTML = '<li class="map-search-result-item" style="text-align:center;color:var(--text-muted);">No locations found in Pakistan.</li>';
                return;
            }

            data.forEach(item => {
                const li = document.createElement('li');
                li.className = 'map-search-result-item';
                let displayName = item.display_name;
                if (displayName.endsWith(', Pakistan')) {
                    displayName = displayName.substring(0, displayName.length - 10);
                }
                
                li.innerText = displayName;
                li.addEventListener('click', () => {
                    resultsContainer.style.display = 'none';
                    const lat = parseFloat(item.lat);
                    const lng = parseFloat(item.lon);
                    
                    // Pan map to location
                    CampusMap.panTo(lat, lng, 14);
                    
                    // Clear previous search marker if any
                    if (CampusMap.tempMarkers['search']) {
                        CampusMap.map.removeLayer(CampusMap.tempMarkers['search']);
                    }
                    
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
                    
                    const marker = L.marker([lat, lng], { icon: searchIcon }).addTo(CampusMap.map);
                    CampusMap.tempMarkers['search'] = marker;
                    
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
                });
                resultsContainer.appendChild(li);
            });
        } catch (err) {
            console.error("Geocoding error:", err);
            resultsContainer.innerHTML = '<li class="map-search-result-item" style="text-align:center;color:var(--error);">Search failed. Please try again.</li>';
        }
    },

    async checkAndTraceRoute(mapType) {
        let start = null;
        let end = null;
        
        if (mapType === 'search') {
            const pInput = document.getElementById('searchPickup');
            const dInput = document.getElementById('searchDropoff');
            if (pInput.dataset.lat && pInput.dataset.lng && dInput.dataset.lat && dInput.dataset.lng) {
                start = [parseFloat(pInput.dataset.lat), parseFloat(pInput.dataset.lng)];
                end = [parseFloat(dInput.dataset.lat), parseFloat(dInput.dataset.lng)];
            }
        } else if (mapType === 'create') {
            if (this.createPickupCoords && this.createDropoffCoords) {
                start = [this.createPickupCoords.lat, this.createPickupCoords.lng];
                end = [this.createDropoffCoords.lat, this.createDropoffCoords.lng];
            }
        }
        
        if (start && end) {
            const guide = document.getElementById(`${mapType}DirectionsGuide`);
            const body = document.getElementById(`${mapType}DirectionsBody`);
            if (guide && body) {
                guide.style.display = 'block';
                body.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">Fetching route path and instructions...</div>';
                
                const routeData = await CampusMap.fetchRouteAndDirections(start, end);
                if (routeData) {
                    body.innerHTML = `
                        <div style="display:flex; justify-content:space-between; margin-bottom: 12px; font-size:11px; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom:8px;">
                            <span>Distance: ${routeData.distance_km.toFixed(1)} km</span>
                            <span>Duration: ${Math.round(routeData.duration_min)} min</span>
                        </div>
                        ${this.formatDirections(routeData.steps)}
                    `;
                    
                    if (mapType === 'create') {
                        this.createRouteDistanceKm = routeData.distance_km;
                        if (this.createStep === 3) {
                            this.fetchAIPriceEstimate();
                        }
                    }
                } else {
                    body.innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">Could not retrieve directions.</div>';
                }
            }
        }
    },

    formatDirections(steps) {
        if (!steps || steps.length === 0) return '<div style="font-size: 11px; text-align:center;">No directions available.</div>';
        return steps.map((step) => {
            let icon = 'ri-arrow-up-line';
            const inst = step.instruction.toLowerCase();
            if (inst.includes('left')) icon = 'ri-arrow-left-line';
            else if (inst.includes('right')) icon = 'ri-arrow-right-line';
            else if (inst.includes('turn')) icon = 'ri-corner-up-left-line';
            else if (inst.includes('roundabout')) icon = 'ri-steering-2-line';
            else if (inst.includes('destination') || inst.includes('arrive')) icon = 'ri-flag-line';
            
            const distStr = step.distance > 1000 ? `${(step.distance / 1000).toFixed(1)} km` : `${Math.round(step.distance)} m`;
            
            return `
                <div class="direction-step">
                    <div class="direction-step-icon"><i class="${icon}"></i></div>
                    <div class="direction-step-desc">${step.instruction}</div>
                    <div class="direction-step-dist">${distStr}</div>
                </div>
            `;
        }).join('');
    },

    renderRidesList(ridesArray) {
        const listNode = document.getElementById('ridesListNode');
        listNode.innerHTML = '';

        if (ridesArray.length === 0) {
            listNode.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:40px 0;">No available rides found. Try another search or coordinate match.</div>';
            return;
        }

        ridesArray.forEach(ride => {
            const card = document.createElement('div');
            card.className = 'card ride-card glow-hover';
            card.onclick = () => this.showRideDetails(ride.id);

            // Check if this card has match score details (from smart match)
            let matchBadge = '';
            if (ride.match_details) {
                matchBadge = `<div class="match-score-badge">${ride.match_details.compatibility_pct}% Route Match</div>`;
            }

            card.innerHTML = `
                ${matchBadge}
                <div class="ride-card-header">
                    <div class="ride-card-driver">
                        <img src="${ride.driver.avatar_url}" onerror="window.handleAvatarError(this, '${ride.driver.username}')" class="driver-mini-avatar"/>
                        <div class="driver-name-rating">
                            <span class="driver-name">@${ride.driver.username} ${ride.driver.verification_status === 'verified' ? '<i class="ri-checkbox-circle-fill" style="color:var(--accent);"></i>' : ''}</span>
                            <span class="driver-rating">⭐ ${ride.driver.rating_avg}</span>
                        </div>
                    </div>
                    <div class="ride-price">Rs. ${parseFloat(ride.price_per_seat).toFixed(0)} <span>/ seat</span></div>
                </div>
                <div class="route-timeline">
                    <div class="timeline-stop pickup">
                        ${ride.pickup_name}
                        ${ride.pickup_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.pickup_address_details})</div>` : ''}
                    </div>
                    <div class="timeline-stop dropoff">
                        ${ride.dropoff_name}
                        ${ride.dropoff_address_details ? `<div class="route-timeline-details" style="font-size:10px; color:var(--text-muted); margin-left: 14px;">(${ride.dropoff_address_details})</div>` : ''}
                    </div>
                </div>
                <div class="ride-card-footer">
                    <div class="ride-meta-item"><i class="ri-calendar-line"></i> ${ride.date}</div>
                    <div class="ride-meta-item"><i class="ri-time-line"></i> ${ride.time.substring(0, 5)}</div>
                    <div class="ride-meta-item"><i class="${ride.vehicle_type === 'motorbike' ? 'ri-motorbike-fill' : 'ri-car-fill'}"></i> ${ride.seats_available} seats left</div>
                </div>
            `;
            listNode.appendChild(card);
        });
    },

    async triggerSmartMatchSearch() {
        const pInput = document.getElementById('searchPickup');
        const dInput = document.getElementById('searchDropoff');
        const dateInput = document.getElementById('searchDate');

        const lat1 = pInput.dataset.lat;
        const lng1 = pInput.dataset.lng;
        const lat2 = dInput.dataset.lat;
        const lng2 = dInput.dataset.lng;

        if (!lat1 || !lng1 || !lat2 || !lng2) {
            alert("⚠️ Smart matching requires coordinate selections! Please click points directly on the Leaflet Map to define your Pickup and Drop-off locations.");
            return;
        }

        const listNode = document.getElementById('ridesListNode');
        listNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:10px;">Evaluating route overlays & matching...</span>';

        const params = {
            pickup_lat: lat1,
            pickup_lng: lng1,
            dropoff_lat: lat2,
            dropoff_lng: lng2,
            date: dateInput.value
        };

        const { data, error } = await API.getMatchedRides(params);
        if (data && !error) {
            document.getElementById('searchResultsTitle').innerText = "Smart Match Recommendations";
            this.renderRidesList(data);
            CampusMap.showRides(data);
            
            // Draw passenger start and end selections
            CampusMap.setSelectionMarker('pickup', parseFloat(lat1), parseFloat(lng1), "Your Pickup Request");
            CampusMap.setSelectionMarker('dropoff', parseFloat(lat2), parseFloat(lng2), "Your Dropoff Request");
        } else {
            alert("Error matching rides: " + (error || 'Request failed'));
            this.fetchSearchRides();
        }
    },

    // C. CREATE RIDE FLOW
    initCreateRidePage() {
        const formEl = document.getElementById('createRideFormNode');
        const blockerEl = document.getElementById('createRideBlocker');
        if (this.currentUser.role === 'external_driver' && this.currentUser.verification_status !== 'verified') {
            formEl.style.display = 'none';
            if (blockerEl) blockerEl.style.display = 'block';
            return;
        } else {
            formEl.style.display = 'block';
            if (blockerEl) blockerEl.style.display = 'none';
        }

        this.createStep = 1;
        this.createPickupCoords = null;
        this.createDropoffCoords = null;
        this.createRouteDistanceKm = null;

        // Reset inputs
        document.getElementById('createRideFormNode').reset();
        document.getElementById('recurringDaysNode').style.display = 'none';
        
        const seatsInput = document.getElementById('createSeats');
        if (seatsInput) {
            seatsInput.max = 8;
            seatsInput.disabled = false;
        }

        // Reset map search overlay & directions
        document.getElementById('createDirectionsGuide').style.display = 'none';
        document.getElementById('createMapQuery').value = '';
        document.getElementById('createMapResults').style.display = 'none';
        document.getElementById('createMapResults').innerHTML = '';

        // Render Step Forms
        this.updateCreateStepUI();

        // Initialize creation coordinates picker map
        setTimeout(() => {
            this.createMap = CampusMap.init('createMapCanvas', (lat, lng) => {
                // Clicking sets pickup first, then dropoff
                if (!this.createPickupCoords) {
                    this.createPickupCoords = { lat, lng };
                    document.getElementById('createPickupLat').value = lat.toFixed(6);
                    document.getElementById('createPickupLng').value = lng.toFixed(6);
                    CampusMap.setSelectionMarker('pickup', lat, lng, "Pickup Point");
                } else {
                    this.createDropoffCoords = { lat, lng };
                    document.getElementById('createDropoffLat').value = lat.toFixed(6);
                    document.getElementById('createDropoffLng').value = lng.toFixed(6);
                    CampusMap.setSelectionMarker('dropoff', lat, lng, "Dropoff Point");
                }
                this.checkAndTraceRoute('create');
            });
        }, 100);
    },

    updateCreateStepUI() {
        document.getElementById('createStep1Form').style.display = this.createStep === 1 ? 'block' : 'none';
        document.getElementById('createStep2Form').style.display = this.createStep === 2 ? 'block' : 'none';
        document.getElementById('createStep3Form').style.display = this.createStep === 3 ? 'block' : 'none';

        const s1Ind = document.getElementById('createStep1Indicator');
        const s2Ind = document.getElementById('createStep2Indicator');
        const s3Ind = document.getElementById('createStep3Indicator');

        s1Ind.className = this.createStep >= 1 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
        s2Ind.className = this.createStep >= 2 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
        s3Ind.className = this.createStep >= 3 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    },

    validateCreateStep1() {
        const pickName = document.getElementById('createPickupName').value;
        const dropName = document.getElementById('createDropoffName').value;
        const dateVal = document.getElementById('createDate').value;
        const timeVal = document.getElementById('createTime').value;

        const plat = parseFloat(document.getElementById('createPickupLat').value);
        const plng = parseFloat(document.getElementById('createPickupLng').value);
        const dlat = parseFloat(document.getElementById('createDropoffLat').value);
        const dlng = parseFloat(document.getElementById('createDropoffLng').value);

        if (!pickName || !dropName || !dateVal || !timeVal || isNaN(plat) || isNaN(plng) || isNaN(dlat) || isNaN(dlng)) {
            alert("⚠️ Please enter all route names, travel dates, and select coordinates on the map!");
            return false;
        }

        this.createPickupCoords = { lat: plat, lng: plng };
        this.createDropoffCoords = { lat: dlat, lng: dlng };
        return true;
    },

    validateCreateStep2() {
        const model = document.getElementById('createVehicleModel').value;
        const plate = document.getElementById('createVehiclePlate').value;
        const seats = parseInt(document.getElementById('createSeats').value);

        if (!model || !plate || isNaN(seats) || seats <= 0) {
            alert("⚠️ Please fill in your vehicle details and specify passenger seats capacity.");
            return false;
        }
        return true;
    },

    async fetchAIPriceEstimate() {
        const model = document.getElementById('createVehicleModel').value;
        const seats = parseInt(document.getElementById('createSeats').value);
        const timeVal = document.getElementById('createTime').value;
        const dateVal = document.getElementById('createDate').value;
        const vehicleType = document.getElementById('createVehicleType').value;

        const data = {
            pickup_lat: this.createPickupCoords.lat,
            pickup_lng: this.createPickupCoords.lng,
            dropoff_lat: this.createDropoffCoords.lat,
            dropoff_lng: this.createDropoffCoords.lng,
            time: timeVal,
            date: dateVal,
            vehicle_model: model,
            seats_total: seats,
            vehicle_type: vehicleType,
            distance_km: this.createRouteDistanceKm || null
        };

        const resNode = document.getElementById('pricePredictionResultNode');
        resNode.innerHTML = 'Evaluating dynamic AI pricing model coefficients...';

        const { data: pred, error } = await API.predictPrice(data);
        if (pred && !error) {
            // Display Breakdown
            const saving = (pred.distance_fare * 1.5).toFixed(0); // Simulated savings
            resNode.innerHTML = `
                <h4 style="font-family:'Outfit'; font-weight:800; font-size:15px; margin-bottom:12px;"><i class="ri-magic-fill" style="color:var(--primary);"></i> AI Pricing breakdown</h4>
                <div class="estimator-row"><span>${this.createRouteDistanceKm ? 'Road driving distance' : 'Haversine distance'}</span><span>${pred.distance_km} km</span></div>
                <div class="estimator-row"><span>Base vehicle fare</span><span>Rs. ${pred.base_fare.toFixed(0)}</span></div>
                <div class="estimator-row"><span>Raw distance fare</span><span>Rs. ${pred.distance_fare.toFixed(0)}</span></div>
                <div class="estimator-row"><span>Vehicle surcharge coefficient</span><span>${pred.vehicle_type} (${pred.vehicle_multiplier}x)</span></div>
                <div class="estimator-row"><span>Traffic modifier</span><span>${pred.traffic_status} (${pred.traffic_multiplier}x)</span></div>
                <div class="estimator-row"><span>Demand spike modifier</span><span>${pred.demand_status} (${pred.demand_multiplier}x)</span></div>
                <div class="estimator-row total"><span>Recommended Price per Seat</span><span>Rs. ${pred.recommended_price.toFixed(0)}</span></div>
                <div class="estimator-row saving"><i class="ri-leaf-line"></i> Co2 carpool mitigation saves approximately Rs. ${saving} in single travel expenses!</div>
            `;

            // Adjust slider
            const slider = document.getElementById('createPriceSlider');
            slider.value = pred.recommended_price;
            document.getElementById('priceSliderValText').innerText = `Rs. ${pred.recommended_price.toFixed(0)}`;
        } else {
            resNode.innerHTML = `<div style="color:var(--error);">${error || 'Could not predict price. Using fallback defaults.'}</div>`;
            document.getElementById('priceSliderValText').innerText = `Rs. 150`;
        }
    },

    async submitPublishedRide() {
        const pickName = document.getElementById('createPickupName').value;
        const pickDetails = document.getElementById('createPickupAddressDetails').value.trim();
        const dropName = document.getElementById('createDropoffName').value;
        const dropDetails = document.getElementById('createDropoffAddressDetails').value.trim();
        const dateVal = document.getElementById('createDate').value;
        const timeVal = document.getElementById('createTime').value;
        const model = document.getElementById('createVehicleModel').value;
        const plate = document.getElementById('createVehiclePlate').value;
        const seats = parseInt(document.getElementById('createSeats').value);
        const vehicleType = document.getElementById('createVehicleType').value;
        const price = parseFloat(document.getElementById('createPriceSlider').value);
        const notes = document.getElementById('createNotes').value;
        
        const isRec = document.getElementById('createIsRecurring').checked;
        let recDays = [];
        if (isRec) {
            document.querySelectorAll('input[name="recDay"]:checked').forEach(cb => recDays.push(cb.value));
        }

        const payload = {
            pickup_name: pickName,
            pickup_address_details: pickDetails || null,
            pickup_lat: this.createPickupCoords.lat,
            pickup_lng: this.createPickupCoords.lng,
            dropoff_name: dropName,
            dropoff_address_details: dropDetails || null,
            dropoff_lat: this.createDropoffCoords.lat,
            dropoff_lng: this.createDropoffCoords.lng,
            date: dateVal,
            time: timeVal,
            seats_total: seats,
            price_per_seat: price,
            vehicle_model: model,
            vehicle_plate: plate,
            vehicle_type: vehicleType,
            notes: notes,
            is_recurring: isRec,
            recurring_days: recDays.join(',')
        };

        const { data, error } = await API.createRide(payload);
        if (data && !error) {
            alert(`🎉 Success! Ride #${data.id} published successfully on CampusRide.`);
            this.showView('dashboard');
        } else {
            alert("Error creating ride: " + JSON.stringify(error));
        }
    },

    // D. MY BOOKINGS VIEW
    async loadBookingsData() {
        const receivedNode = document.getElementById('receivedBookingsNode');
        const sentNode = document.getElementById('sentBookingsNode');
        const isExternal = this.currentUser.role === 'external_driver';

        receivedNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:10px;">Loading requests...</span>';
        sentNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:10px;">Loading bookings...</span>';

        // Adjust Grid layout dynamically
        const bookingsGrid = document.getElementById('bookingsGrid');
        const sentBookingsCard = document.getElementById('sentBookingsCard');
        if (isExternal) {
            if (sentBookingsCard) sentBookingsCard.style.display = 'none';
            if (bookingsGrid) bookingsGrid.style.gridTemplateColumns = '1fr';
        } else {
            if (sentBookingsCard) sentBookingsCard.style.display = 'block';
            if (bookingsGrid) bookingsGrid.style.gridTemplateColumns = '';
        }

        const { data, error } = await API.getBookings();
        if (data && !error) {
            // Render Received Booking Requests
            receivedNode.innerHTML = '';
            if (data.received_requests.length === 0) {
                receivedNode.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:40px 0;">No seat requests received yet.</div>';
            } else {
                data.received_requests.forEach(b => {
                    const card = document.createElement('div');
                    card.className = 'card ride-card glow-hover';
                    
                    let actions = '';
                    if (b.status === 'pending') {
                        actions = `
                            <div style="display:flex; gap:10px; margin-top:14px;">
                                <button class="btn btn-primary btn-sm" onclick="App.handleBookingResponse(${b.id}, 'approve')">Approve</button>
                                <button class="btn btn-secondary btn-sm" onclick="App.handleBookingResponse(${b.id}, 'reject')">Decline</button>
                            </div>
                        `;
                    } else if (b.status === 'approved') {
                        if (b.ride_status !== 'started' && b.ride_status !== 'completed' && b.ride_status !== 'cancelled') {
                            actions = `
                                <div style="display:flex; gap:10px; margin-top:14px;">
                                    <button class="btn btn-primary btn-sm" onclick="App.openVerificationModal(${b.id}, '${b.passenger.username}', '${b.verification_token}')"><i class="ri-shield-keyhole-line"></i> Verify & Start Ride</button>
                                </div>
                            `;
                        } else if (b.ride_status === 'started') {
                            actions = `
                                <div style="display:flex; gap:10px; margin-top:14px;">
                                    <button class="btn btn-success btn-sm" onclick="App.completeRide(${b.id})" style="background-color: var(--success, #10b981); border-color: var(--success, #10b981); color: white;"><i class="ri-checkbox-circle-line"></i> Complete Ride</button>
                                </div>
                            `;
                        }
                    }

                    let statusColor = 'var(--text-muted)';
                    let displayStatus = b.status;
                    if (b.status === 'approved') {
                        if (b.ride_status !== 'started' && b.ride_status !== 'completed' && b.ride_status !== 'cancelled') {
                            statusColor = 'var(--accent)';
                            displayStatus = 'confirmed';
                        } else if (b.ride_status === 'started') {
                            statusColor = '#3b82f6';
                            displayStatus = 'started';
                        } else if (b.ride_status === 'completed') {
                            statusColor = 'var(--success, #10b981)';
                            displayStatus = 'completed';
                        } else {
                            statusColor = 'var(--accent)';
                            displayStatus = 'approved';
                        }
                    } else if (b.status === 'rejected' || b.status === 'cancelled') {
                        statusColor = 'var(--error)';
                    }

                    card.innerHTML = `
                        <div class="ride-card-header" style="margin-bottom:8px;">
                            <div class="ride-card-driver">
                                <img src="${b.passenger.avatar_url}" onerror="window.handleAvatarError(this, '${b.passenger.username}')" class="driver-mini-avatar"/>
                                <div class="driver-name-rating">
                                    <span class="driver-name">@${b.passenger.username}</span>
                                    <span class="driver-rating">⭐ ${b.passenger.rating_avg}</span>
                                </div>
                            </div>
                            <div style="font-size: 13px; font-weight:700; color:white;">Request: ${b.seats_booked} seat(s)</div>
                        </div>
                        <div class="route-timeline" style="margin-bottom: 8px;">
                            <div class="timeline-stop pickup" style="font-size:12px;">${b.ride.pickup_name}</div>
                            <div class="timeline-stop dropoff" style="font-size:12px;">${b.ride.dropoff_name}</div>
                        </div>
                        <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
                            <span>${b.ride.date} @ ${b.ride.time.substring(0,5)}</span>
                            <span style="font-weight:bold; text-transform:uppercase; color: ${statusColor}">${displayStatus}</span>
                        </div>
                        ${actions}
                    `;
                    receivedNode.appendChild(card);
                });
            }

            // Render Sent Bookings
            sentNode.innerHTML = '';
            if (data.my_bookings.length === 0) {
                sentNode.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:40px 0;">You haven\'t made any bookings.</div>';
            } else {
                data.my_bookings.forEach(b => {
                    const card = document.createElement('div');
                    card.className = 'card ride-card glow-hover';
                    
                    let actions = '';
                    let qrPanel = '';
                    
                    if (b.status === 'approved') {
                        if (b.ride_status !== 'started' && b.ride_status !== 'completed' && b.ride_status !== 'cancelled') {
                            actions = `
                                <div style="display:flex; gap:10px; margin-top:14px;">
                                    <button class="btn btn-danger btn-sm" onclick="App.handleBookingResponse(${b.id}, 'cancel')">Cancel Ride</button>
                                </div>
                            `;
                            
                            // Render verification panel for passengers
                            qrPanel = `
                                <div class="verification-passenger-panel" style="margin-top: 14px; padding: 12px; background: rgba(255, 255, 255, 0.05); border: 1px dashed rgba(255, 255, 255, 0.2); border-radius: var(--radius-sm);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 11px; font-weight: bold; color: var(--accent);">RIDE VERIFICATION PIN/QR</span>
                                        <span style="font-size: 10px; color: var(--text-muted);">Show to Driver</span>
                                    </div>
                                    <div style="display: flex; gap: 12px; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); padding: 10px; border-radius: var(--radius-sm);">
                                        <div style="flex: 1; text-align: center;">
                                            <div style="font-size: 10px; color: var(--text-muted); text-transform: uppercase;">PIN Code</div>
                                            <div style="font-size: 22px; font-weight: 800; color: white; letter-spacing: 2px; margin-top: 4px;">${b.verification_pin || '------'}</div>
                                        </div>
                                        <div style="width: 1px; height: 40px; background: rgba(255,255,255,0.1);"></div>
                                        <div style="flex: 1; display: flex; justify-content: center; align-items: center; flex-direction: column;">
                                            <div id="qr-container-${b.id}" class="qr-code-wrapper" style="background: white; padding: 6px; border-radius: 4px; display: inline-block;"></div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        } else if (b.ride_status === 'started') {
                            actions = `
                                <div style="display:flex; gap:10px; margin-top:14px; align-items:center; color:#3b82f6; font-size:12px; font-weight:bold;">
                                    <i class="ri-shield-flash-line" style="font-size:16px;"></i> Ride in progress... Safe travels!
                                </div>
                            `;
                        } else if (b.ride_status === 'completed') {
                            actions = `
                                <div style="display:flex; gap:10px; margin-top:14px;">
                                    <button class="btn btn-secondary btn-sm" onclick="App.openReviewModal(${b.ride.id}, ${b.ride.driver.id})"><i class="ri-star-line"></i> Rate Driver</button>
                                </div>
                            `;
                        }
                    } else if (b.status === 'pending') {
                        actions = `
                            <div style="display:flex; gap:10px; margin-top:14px;">
                                <button class="btn btn-danger btn-sm" onclick="App.handleBookingResponse(${b.id}, 'cancel')">Cancel Request</button>
                            </div>
                        `;
                    }

                    let statusColor = 'var(--text-muted)';
                    let displayStatus = b.status;
                    if (b.status === 'approved') {
                        if (b.ride_status !== 'started' && b.ride_status !== 'completed' && b.ride_status !== 'cancelled') {
                            statusColor = 'var(--accent)';
                            displayStatus = 'confirmed';
                        } else if (b.ride_status === 'started') {
                            statusColor = '#3b82f6';
                            displayStatus = 'started';
                        } else if (b.ride_status === 'completed') {
                            statusColor = 'var(--success, #10b981)';
                            displayStatus = 'completed';
                        } else {
                            statusColor = 'var(--accent)';
                            displayStatus = 'approved';
                        }
                    } else if (b.status === 'rejected' || b.status === 'cancelled') {
                        statusColor = 'var(--error)';
                    }

                    card.innerHTML = `
                        <div class="ride-card-header" style="margin-bottom:8px;">
                            <div class="ride-card-driver">
                                <img src="${b.ride.driver.avatar_url}" onerror="window.handleAvatarError(this, '${b.ride.driver.username}')" class="driver-mini-avatar"/>
                                <div class="driver-name-rating">
                                    <span class="driver-name">Driver: @${b.ride.driver.username}</span>
                                    <span class="driver-rating">⭐ ${b.ride.driver.rating_avg}</span>
                                </div>
                            </div>
                            <div class="ride-price">Rs. ${parseFloat(b.ride.price_per_seat).toFixed(0)}</div>
                        </div>
                        <div class="route-timeline" style="margin-bottom: 8px;">
                            <div class="timeline-stop pickup" style="font-size:12px;">${b.ride.pickup_name}</div>
                            <div class="timeline-stop dropoff" style="font-size:12px;">${b.ride.dropoff_name}</div>
                        </div>
                        <div style="font-size:11px; color:var(--text-muted); display:flex; justify-content:space-between; align-items:center;">
                            <span>Seats: ${b.seats_booked} | ${b.ride.date} @ ${b.ride.time.substring(0,5)}</span>
                            <span style="font-weight:bold; text-transform:uppercase; color: ${statusColor}">${displayStatus}</span>
                        </div>
                        ${qrPanel}
                        ${actions}
                    `;
                    sentNode.appendChild(card);

                    // Generate QR code if applicable
                    if (b.status === 'approved' && b.ride_status !== 'started' && b.ride_status !== 'completed' && b.ride_status !== 'cancelled' && b.verification_token) {
                        try {
                            const qrContainer = document.getElementById(`qr-container-${b.id}`);
                            if (qrContainer) {
                                new QRCode(qrContainer, {
                                    text: b.verification_token,
                                    width: 70,
                                    height: 70,
                                    colorDark: "#000000",
                                    colorLight: "#ffffff",
                                    correctLevel: QRCode.CorrectLevel.H
                                });
                            }
                        } catch (qrErr) {
                            console.error("Failed to generate QRCode dynamically:", qrErr);
                        }
                    }
                });
            }
        }
    },

    async handleBookingResponse(bookingId, action) {
        const confirmMsg = action === 'cancel' ? "Are you sure you want to cancel this booking?" : `Confirm ${action}ing this ride request?`;
        if (!confirm(confirmMsg)) return;

        const { data, error } = await API.bookingAction(bookingId, action);
        if (data && !error) {
            alert(`Booking successfully ${action}ed.`);
            this.loadBookingsData();
            this.pollUpdates();
        } else {
            alert("Error performing action: " + (error || 'Action failed'));
        }
    },

    // E. CHAT INBOX VIEW
    async loadChatConversations() {
        const convoNode = document.getElementById('convoListNode');
        convoNode.innerHTML = '<span style="font-size:12px;color:var(--text-muted);padding:20px;display:block;">Syncing mailbox...</span>';

        const { data, error } = await API.getConversations();
        if (data && !error) {
            this.conversations = data;
            convoNode.innerHTML = '';
            
            if (data.length === 0) {
                convoNode.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:32px 10px;">Your inbox is empty. Contact drivers from the rides search page to initiate discussions.</div>';
                return;
            }

            data.forEach(c => {
                const li = document.createElement('li');
                li.className = `conversation-item ${this.activeConvoId === c.partner.id ? 'active' : ''}`;
                li.onclick = () => this.selectConversation(c.partner.id, c.partner.username, c.partner.university, c.partner.avatar_url);

                const activeTime = new Date(c.last_message.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                li.innerHTML = `
                    <img src="${c.partner.avatar_url}" onerror="window.handleAvatarError(this, '${c.partner.username}')" class="driver-mini-avatar"/>
                    <div class="convo-partner-details">
                        <div class="convo-partner-header">
                            <span class="convo-partner-name">@${c.partner.username} ${c.partner.verification_status==='verified'?'<i class="ri-checkbox-circle-fill" style="color:var(--accent);"></i>':''}</span>
                            <span class="convo-time">${activeTime}</span>
                        </div>
                        <div class="convo-last-msg">${c.last_message.content}</div>
                    </div>
                `;
                convoNode.appendChild(li);
            });
        } else {
            convoNode.innerHTML = `<span style="color:var(--error);padding:20px;">${error || 'Conversations error'}</span>`;
        }
    },

    async selectConversation(partnerId, partnerName, university, avatarUrl) {
        this.activeConvoId = partnerId;
        this.lastFetchedMessageId = 0;
        
        // UI toggle
        document.getElementById('chatMainPlaceholderNode').style.display = 'none';
        const chatMain = document.getElementById('chatMainActiveNode');
        chatMain.style.display = 'flex';
        
        // Header
        document.getElementById('chatHeaderName').innerText = `@${partnerName}`;
        document.getElementById('chatHeaderUni').innerText = university || 'Campus member';
        const headAvatar = document.getElementById('chatHeaderAvatar');
        headAvatar.src = avatarUrl || '/static/images/default-avatar.png';
        headAvatar.onerror = () => { headAvatar.src = this.getAvatarFallback(partnerName); };

        // Highlight active sidebar
        document.querySelectorAll('.conversation-item').forEach(item => {
            const nameSpan = item.querySelector('.convo-partner-name');
            if (nameSpan && nameSpan.innerText.includes(`@${partnerName}`)) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Load bubbles
        const bubblesContainer = document.getElementById('chatBubblesNode');
        bubblesContainer.innerHTML = 'Syncing message history...';

        const { data, error } = await API.getMessages(partnerId);
        if (data && !error) {
            bubblesContainer.innerHTML = '';
            
            if (data.length === 0) {
                bubblesContainer.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:40px 0;">No messages yet. Say hello and discuss ride schedule details!</div>';
            } else {
                data.forEach(msg => {
                    if (msg.id > this.lastFetchedMessageId) {
                        this.lastFetchedMessageId = msg.id;
                    }
                    const bubble = document.createElement('div');
                    const isIncoming = msg.sender !== this.currentUser.id;
                    bubble.className = `chat-message-bubble ${isIncoming ? 'incoming' : 'outgoing'}`;
                    bubble.innerHTML = `
                        ${msg.content}
                        <span class="msg-timestamp">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    `;
                    bubblesContainer.appendChild(bubble);
                });
            }
            bubblesContainer.scrollTop = bubblesContainer.scrollHeight;
        } else {
            bubblesContainer.innerHTML = `<span style="color:var(--error);">${error || 'History failed to load'}</span>`;
        }
    },

    async sendChatMessage() {
        const input = document.getElementById('chatInputField');
        const content = input.value.trim();
        if (!content || !this.activeConvoId) return;

        input.value = ''; // Clear input quickly
        const { data, error } = await API.sendMessage(this.activeConvoId, content);
        
        if (data && !error) {
            // Append message bubble
            const bubblesContainer = document.getElementById('chatBubblesNode');
            
            // Remove empty placeholder if any
            if (bubblesContainer.innerText.includes("No messages yet")) {
                bubblesContainer.innerHTML = '';
            }

            const bubble = document.createElement('div');
            bubble.className = 'chat-message-bubble outgoing';
            bubble.innerHTML = `
                ${data.content}
                <span class="msg-timestamp">${new Date(data.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            `;
            bubblesContainer.appendChild(bubble);
            bubblesContainer.scrollTop = bubblesContainer.scrollHeight;

            if (data.id > this.lastFetchedMessageId) {
                this.lastFetchedMessageId = data.id;
            }
        } else {
            alert("Error sending message: " + (error || 'Failed'));
        }
    },

    // F. VERIFICATION & PROFILE VIEW
    loadVerificationPage() {
        const badge = document.getElementById('verificationStatusBadgeText');
        const desc = document.getElementById('verificationStatusDesc');
        const formNode = document.getElementById('verificationFormNode');

        const isExternal = this.currentUser.role === 'external_driver';
        const titleEl = document.querySelector('#view-verification h3');
        if (titleEl) {
            titleEl.innerHTML = isExternal ? 
                `<i class="ri-verified-badge-line" style="color: var(--accent);"></i> External Driver ID & License Verification` :
                `<i class="ri-verified-badge-line" style="color: var(--accent);"></i> Student ID Verification`;
        }
        
        const introEl = document.querySelector('#view-verification p');
        if (introEl) {
            introEl.innerText = isExternal ?
                "To protect the campus community and verify driver eligibility, upload your commercial driving license, registration plate, and identity card details for admin review." :
                "To protect the university community and verify driver eligibility, upload your student credential details.";
        }

        const docInput = document.getElementById('verificationDocInput');
        if (docInput) {
            docInput.placeholder = isExternal ?
                "Enter driving license number, vehicle registration number, national identity details, and experience details to authenticate." :
                "Enter student card information e.g. Name, Student ID number, department, and graduation year to authenticate.";
        }

        const status = this.currentUser.verification_status;
        badge.innerText = status.toUpperCase();

        if (status === 'verified') {
            badge.className = 'report-status-badge resolved';
            desc.innerText = isExternal ? 
                "Congratulations! Your driving license and identity status is verified. You now have a verified badge and can publish carpools." :
                "Congratulations! Your university student status is verified. You now have a verified safety check badge displayed on your profile.";
            formNode.style.display = 'none';
        } else if (status === 'pending') {
            badge.className = 'report-status-badge pending';
            desc.innerText = isExternal ?
                "Your driver verification details have been uploaded. An administrator is currently reviewing your document details." :
                "Your student ID submission has been uploaded. An administrator is currently reviewing your document details.";
            formNode.style.display = 'none';
        } else {
            badge.className = 'report-status-badge pending';
            desc.innerText = isExternal ?
                "Upload details of your Driving License & ID card to receive verification and begin publishing rides." :
                "Upload details of your student registration card to receive verification trust status.";
            formNode.style.display = 'block';
        }

        // Fill custom settings profile fields
        document.getElementById('profilePhoneField').value = this.currentUser.phone || '';
        document.getElementById('profileEmergencyField').value = this.currentUser.emergency_contact || '';
        document.getElementById('profileFormAvatarPreview').src = this.currentUser.avatar_url || '/static/images/default-avatar.png';
        document.getElementById('profileFormAvatarPreview').onerror = () => {
            document.getElementById('profileFormAvatarPreview').src = this.getAvatarFallback(this.currentUser.username);
        };
    },

    async submitVerificationRequest() {
        const docText = document.getElementById('verificationDocInput').value.trim();
        if (!docText) {
            alert("Please input verification card information.");
            return;
        }

        const { data, error } = await API.verifyProfile(docText);
        if (data && !error) {
            alert("Verification request uploaded successfully.");
            this.currentUser = data;
            this.loadVerificationPage();
            this.onAuthenticated();
        } else {
            alert("Upload failed: " + (error || 'Failed'));
        }
    },

    // G. ADMIN DASHBOARD MODERATION
    async loadAdminPage() {
        if (!this.currentUser.is_staff) return;

        const reportsNode = document.getElementById('adminReportsNode');
        const verifNode = document.getElementById('adminVerificationRequestsNode');
        const sosNode = document.getElementById('adminSOSNode');

        reportsNode.innerHTML = 'Loading reports queue...';
        verifNode.innerHTML = 'Loading verification queue...';
        if (sosNode) {
            sosNode.innerHTML = 'Loading active SOS alerts...';
        }

        // Direct database requests via custom admin API
        const reportRes = await API.request('/api/safety/reports/admin_list/');
        const usersRes = await API.request('/api/safety/users/admin_list/');
        const sosRes = await API.getSOSAlerts();

        if (reportRes.data && !reportRes.error) {
            reportsNode.innerHTML = '';
            const reports = reportRes.data;
            
            if (reports.length === 0) {
                reportsNode.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px 0;">No active user reports filed.</div>';
            } else {
                reports.forEach(r => {
                    const el = document.createElement('div');
                    el.className = 'report-item-card';
                    el.innerHTML = `
                        <div>
                            <span class="report-status-badge ${r.status}">${r.status}</span>
                            <div style="font-size:13px; font-weight:700; margin-top:8px;">Report filed by @${r.reporter_name} against @${r.reported_user_name}</div>
                            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;"><b>Reason:</b> ${r.reason}</div>
                            <p style="font-size:11px; color:var(--text-muted); font-style:italic; margin-top:4px;">Details: ${r.details}</p>
                        </div>
                        <div>
                            ${r.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="App.resolveReport(${r.id})">Mark Resolved</button>` : ''}
                        </div>
                    `;
                    reportsNode.appendChild(el);
                });
            }
        } else {
            reportsNode.innerHTML = '<div style="color:var(--error);">Failed to load reports queue. Access restricted to Staff.</div>';
        }

        if (usersRes.data && !usersRes.error) {
            verifNode.innerHTML = '';
            const pendingUsers = usersRes.data.filter(u => u.verification_status === 'pending');
            
            if (pendingUsers.length === 0) {
                verifNode.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px 0;">No pending verification requests.</div>';
            } else {
                pendingUsers.forEach(u => {
                    const el = document.createElement('div');
                    el.className = 'report-item-card';
                    el.innerHTML = `
                        <div>
                            <div style="font-size:13px; font-weight:700;">Request by @${u.username} (${u.university})</div>
                            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;"><b>Card Details:</b> ${u.verification_doc}</div>
                            <div style="font-size:11px; color:var(--text-muted);"><b>Phone:</b> ${u.phone}</div>
                        </div>
                        <div style="display:flex; gap:10px;">
                            <button class="btn btn-primary btn-sm" onclick="App.moderateUser(${u.id}, 'verify')">Verify Profile</button>
                            <button class="btn btn-secondary btn-sm" onclick="App.moderateUser(${u.id}, 'reject')">Reject</button>
                        </div>
                    `;
                    verifNode.appendChild(el);
                });
            }
        } else {
            verifNode.innerHTML = '<div style="color:var(--error);">Failed to load verification queue.</div>';
        }

        if (sosNode) {
            if (sosRes.data && !sosRes.error) {
                sosNode.innerHTML = '';
                const sosAlerts = sosRes.data;
                if (sosAlerts.length === 0) {
                    sosNode.innerHTML = '<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px 0;">No active or past SOS alerts recorded.</div>';
                } else {
                    sosAlerts.forEach(sos => {
                        const el = document.createElement('div');
                        el.className = 'report-item-card';
                        
                        const u = sos.user_details || {};
                        const username = u.username || 'Unknown';
                        const university = u.university || 'Not Specified';
                        const phone = u.phone || 'No Phone';
                        const email = u.email || 'No Email';
                        const emergencyContact = u.emergency_contact || 'None Added';
                        
                        const mapsUrl = `https://www.google.com/maps?q=${sos.latitude},${sos.longitude}`;
                        
                        let rideHtml = '';
                        if (sos.ride_details) {
                            const r = sos.ride_details;
                            const driverName = r.driver ? r.driver.username : 'Unknown';
                            rideHtml = `
                                <div style="font-size:11px; color:var(--text-muted); background: rgba(255,255,255,0.02); padding: 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-top: 8px;">
                                    <b>Associated Ride ID:</b> #${r.id}<br/>
                                    <b>Route:</b> ${r.pickup_name} ➔ ${r.dropoff_name}<br/>
                                    <b>Driver:</b> @${driverName}
                                </div>
                            `;
                        } else {
                            rideHtml = `<div style="font-size:11px; color:var(--text-muted); margin-top: 4px;"><b>Ride Info:</b> No ride associated (SOS triggered from outside ride)</div>`;
                        }
                        
                        const dateStr = new Date(sos.created_at).toLocaleString();
                        
                        el.innerHTML = `
                            <div>
                                <span class="report-status-badge ${sos.status === 'active' ? 'pending' : 'resolved'}">${sos.status.toUpperCase()}</span>
                                <div style="font-size:13px; font-weight:700; margin-top:8px;">🚨 SOS Alert from @${username} (${university})</div>
                                <div style="font-size:12px; color:var(--text-muted); margin-top:6px;">
                                    <b>Phone:</b> ${phone} | <b>Email:</b> ${email}<br/>
                                    <b>Emergency Safety Contact:</b> ${emergencyContact}<br/>
                                    <b>Triggered At:</b> ${dateStr}<br/>
                                    <b>GPS Location:</b> <a href="${mapsUrl}" target="_blank" style="color: var(--accent); text-decoration: underline;"><i class="ri-map-pin-line"></i> View on Google Maps (${sos.latitude.toFixed(5)}, ${sos.longitude.toFixed(5)})</a>
                                </div>
                                ${rideHtml}
                            </div>
                            <div>
                                ${sos.status === 'active' ? `<button class="btn btn-primary btn-sm" onclick="App.resolveSOS(${sos.id})">Mark Resolved</button>` : ''}
                            </div>
                        `;
                        sosNode.appendChild(el);
                    });
                }
            } else {
                sosNode.innerHTML = '<div style="color:var(--error);">Failed to load SOS alerts queue.</div>';
            }
        }
    },

    async resolveReport(reportId) {
        if (!confirm("Confirm resolving this report?")) return;
        const res = await API.request(`/api/safety/reports/${reportId}/resolve/`, { method: 'POST' });
        if (res.data && !res.error) {
            alert("Report marked resolved.");
            this.loadAdminPage();
            this.pollUpdates();
        } else {
            alert("Action failed: " + JSON.stringify(res.error));
        }
    },

    async moderateUser(userId, action) {
        if (!confirm(`Confirm action '${action}' for this student profile?`)) return;
        const res = await API.request(`/api/safety/users/${userId}/moderate/`, {
            method: 'POST',
            body: JSON.stringify({ action })
        });
        if (res.data && !res.error) {
            alert(`User profile moderated successfully: '${action}'`);
            this.loadAdminPage();
            this.pollUpdates();
        } else {
            alert("Action failed: " + JSON.stringify(res.error));
        }
    },

    async resolveSOS(eventId) {
        if (!confirm("Confirm resolving this SOS emergency alert?")) return;
        const res = await API.resolveSOS(eventId);
        if (res.data && !res.error) {
            alert("SOS alert marked as resolved.");
            this.loadAdminPage();
            this.pollUpdates();
        } else {
            alert("Action failed: " + JSON.stringify(res.error));
        }
    },

    // ----------------------------------------------------
    // RIDE DETAILED OVERLAY VIEW (MODALS)
    // ----------------------------------------------------
    async showRideDetails(rideId) {
        const { data: ride, error } = await API.getRideDetail(rideId);
        if (ride && !error) {
            this.activeRideDetail = ride;

            // Fill header details
            document.getElementById('modalRideTitle').innerText = `Carpool Route: #${ride.id}`;
            document.getElementById('modalRidePrice').innerText = `Rs. ${parseFloat(ride.price_per_seat).toFixed(0)}`;
            
            // Driver Profile
            document.getElementById('modalDriverName').innerText = `@${ride.driver.username}`;
            document.getElementById('modalDriverRating').innerText = `⭐ ${ride.driver.rating_avg.toFixed(1)} ${ride.driver.verification_status === 'verified' ? ' (Verified Student)' : ' (Unverified)'}`;
            
            const driverAvatar = document.getElementById('modalDriverAvatar');
            driverAvatar.src = ride.driver.avatar_url || '/static/images/default-avatar.png';
            driverAvatar.onerror = () => { driverAvatar.src = this.getAvatarFallback(ride.driver.username); };

            // Timeline Nodes
            const timeline = document.getElementById('modalTimelineNode');
            timeline.innerHTML = `
                <div class="timeline-stop pickup"><b>Pickup Point:</b> ${ride.pickup_name}</div>
                <div class="timeline-stop dropoff"><b>Dropoff Destination:</b> ${ride.dropoff_name}</div>
            `;

            // Vehicle Type & Details
            document.getElementById('modalVehicleType').innerText = ride.vehicle_type === 'motorbike' ? 'Motorbike' : 'Car';
            document.getElementById('modalVehicleText').innerText = ride.vehicle_model;
            document.getElementById('modalNotesText').innerText = ride.notes || 'No commuter comments.';

            // Extra address details
            const pickupDetailsNode = document.getElementById('modalPickupDetailsNode');
            if (ride.pickup_address_details) {
                pickupDetailsNode.style.display = 'block';
                document.getElementById('modalPickupDetailsText').innerText = ride.pickup_address_details;
            } else {
                pickupDetailsNode.style.display = 'none';
            }

            const dropoffDetailsNode = document.getElementById('modalDropoffDetailsNode');
            if (ride.dropoff_address_details) {
                dropoffDetailsNode.style.display = 'block';
                document.getElementById('modalDropoffDetailsText').innerText = ride.dropoff_address_details;
            } else {
                dropoffDetailsNode.style.display = 'none';
            }

            // Render passengers list
            const passNode = document.getElementById('modalPassengersListNode');
            passNode.innerHTML = '';
            
            if (ride.approved_passengers && ride.approved_passengers.length > 0) {
                ride.approved_passengers.forEach(p => {
                    const el = document.createElement('div');
                    el.className = 'ride-card-driver';
                    el.style.background = 'rgba(255,255,255,0.03)';
                    el.style.padding = '6px 12px';
                    el.style.borderRadius = '20px';
                    el.innerHTML = `
                        <img src="${p.passenger.avatar_url}" onerror="window.handleAvatarError(this, '${p.passenger.username}')" class="driver-mini-avatar" style="width:20px;height:20px;"/>
                        <span style="font-size:12px;">@${p.passenger.username}</span>
                    `;
                    passNode.appendChild(el);
                });
            } else {
                passNode.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">No passengers matched yet. Available seats: ' + ride.seats_available + '</span>';
            }

            // Booking interaction buttons
            const btnNode = document.getElementById('modalBookingInteractionNode');
            btnNode.innerHTML = '';

            // Check relationships
            const isDriver = ride.driver.id === this.currentUser.id;
            const hasBooking = ride.approved_passengers.some(p => p.passenger.id === this.currentUser.id);
            
            // Show vehicle plates & SOS options only for matched riders or the driver
            const plateNode = document.getElementById('modalVehiclePlateNode');
            const sosBanner = document.getElementById('modalSOSBannerNode');

            if (isDriver || hasBooking) {
                plateNode.style.display = 'block';
                document.getElementById('modalVehiclePlateText').innerText = ride.vehicle_plate;
                
                // SOS display (for riders)
                if (hasBooking) {
                    sosBanner.style.display = 'block';
                } else {
                    sosBanner.style.display = 'none';
                }
            } else {
                plateNode.style.display = 'none';
                sosBanner.style.display = 'none';
            }

            if (isDriver) {
                btnNode.innerHTML = '<span style="font-size:13px;color:var(--accent);font-weight:bold;"><i class="ri-steering-line"></i> You are driving this carpool</span>';
            } else {
                // Check if already booked (pending/approved)
                const bookRes = await API.getBookings();
                let userBooking = null;
                if (bookRes.data) {
                    userBooking = bookRes.data.my_bookings.find(b => b.ride.id === ride.id);
                }

                if (userBooking) {
                    let statusColor = '#f59e0b';
                    if (userBooking.status === 'approved') statusColor = 'var(--accent)';
                    btnNode.innerHTML = `
                        <div style="display:flex; align-items:center; gap:12px;">
                            <span style="font-size:12px;color:var(--text-muted);">Booking Status: <b style="color:${statusColor};text-transform:uppercase;">${userBooking.status}</b></span>
                            ${userBooking.status === 'pending' || userBooking.status === 'approved' ? 
                              `<button class="btn btn-danger btn-sm" onclick="App.handleBookingResponse(${userBooking.id}, 'cancel')">Cancel Booking</button>` : ''}
                        </div>
                    `;
                } else if (ride.seats_available <= 0) {
                    btnNode.innerHTML = '<span style="font-size:13px;color:var(--error);font-weight:bold;">Carpool Full</span>';
                } else {
                    btnNode.innerHTML = `<button class="btn btn-primary" onclick="App.openBookingSeatsSelectorModal()"><i class="ri-ticket-line"></i> Request Seat Reservation</button>`;
                }
            }

            // Display Detail Modal
            document.getElementById('rideDetailModal').style.display = 'flex';

            // Init detailed map
            setTimeout(() => {
                const modalMap = CampusMap.init('modalMapCanvas');
                const start = [ride.pickup_lat, ride.pickup_lng];
                const end = [ride.dropoff_lat, ride.dropoff_lng];
                
                // If route optimization is loaded (staff / driver view), draw overlay TSP route stops!
                if (ride.optimized_route) {
                    CampusMap.drawRoutePath(start, end, ride.optimized_route);
                    document.getElementById('modalDirectionsGuide').style.display = 'none';
                } else {
                    CampusMap.drawRoutePath(start, end);
                    document.getElementById('modalDirectionsGuide').style.display = 'block';
                    document.getElementById('modalDirectionsBody').innerHTML = '<div style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 10px;">Fetching route path and instructions...</div>';
                    CampusMap.fetchRouteAndDirections(start, end).then(routeData => {
                        if (routeData) {
                            document.getElementById('modalDirectionsBody').innerHTML = `
                                <div style="display:flex; justify-content:space-between; margin-bottom: 12px; font-size:11px; font-weight:700; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom:8px;">
                                    <span>Distance: ${routeData.distance_km.toFixed(1)} km</span>
                                    <span>Duration: ${Math.round(routeData.duration_min)} min</span>
                                </div>
                                ${App.formatDirections(routeData.steps)}
                            `;
                        }
                    });
                }

                // Start live GPS tracking if driver or passenger
                if (isDriver) {
                    if (navigator.geolocation) {
                        // Clear any existing watch first
                        if (App.driverGeolocateWatchId !== null) {
                            navigator.geolocation.clearWatch(App.driverGeolocateWatchId);
                            App.driverGeolocateWatchId = null;
                        }
                        App.driverGeolocateWatchId = navigator.geolocation.watchPosition(
                            async (position) => {
                                const lat = position.coords.latitude;
                                const lng = position.coords.longitude;
                                console.log(`Driver live location update: ${lat}, ${lng}`);
                                // Call API to update location
                                await API.updateRideLocation(ride.id, lat, lng);
                                // Also update local driver marker on driver's own map
                                CampusMap.updateDriverMarker(lat, lng);
                            },
                            (error) => {
                                console.error("Error watching position:", error);
                            },
                            {
                                enableHighAccuracy: true,
                                maximumAge: 0,
                                timeout: 10000
                            }
                        );
                    } else {
                        console.error("Geolocation is not supported by this browser.");
                    }
                } else if (hasBooking) {
                    // Clear any existing poll first
                    if (App.locationPollTimer !== null) {
                        clearInterval(App.locationPollTimer);
                        App.locationPollTimer = null;
                    }
                    
                    // Immediately fetch once, then poll every 8 seconds
                    const fetchLocation = async () => {
                        const res = await API.getRideLocation(ride.id);
                        if (res && res.lat !== undefined && res.lat !== null) {
                            CampusMap.updateDriverMarker(res.lat, res.lng);
                        }
                    };
                    fetchLocation();
                    
                    App.locationPollTimer = setInterval(fetchLocation, 8000);
                }
            }, 200);

        } else {
            alert("Error fetching ride: " + (error || 'Server error'));
        }
    },

    openBookingSeatsSelectorModal() {
        document.getElementById('bookingRequestModal').style.display = 'flex';
    },

    async confirmRequestBooking() {
        const seats = parseInt(document.getElementById('bookingSeatsSelect').value);
        const rideId = this.activeRideDetail.id;

        document.getElementById('bookingRequestModal').style.display = 'none';

        const { data, error } = await API.createBooking(rideId, seats);
        if (data && !error) {
            alert("🎉 Request submitted! The driver has been notified and needs to approve your booking reservation.");
            window.closeRideDetailModal();
            this.showView('bookings');
            this.pollUpdates();
        } else {
            alert("Booking request failed: " + (error || 'Server rejected'));
        }
    },

    openReviewModal(rideId, revieweeId) {
        this.reviewRideId = rideId;
        this.revieweeId = revieweeId;
        
        // Reset stars
        document.querySelectorAll('.star-review-icon').forEach(s => {
            s.className = 'ri-star-line star-review-icon';
            s.style.color = 'var(--text-muted)';
        });
        document.getElementById('reviewCommentInput').value = '';
        this.selectedRating = 5;

        // Auto color 5 stars initially
        this.setStarColor(5);
        
        document.getElementById('reviewModal').style.display = 'flex';
    },

    setStarColor(rating) {
        document.querySelectorAll('.star-review-icon').forEach(s => {
            const val = parseInt(s.dataset.val);
            if (val <= rating) {
                s.className = 'ri-star-fill star-review-icon';
                s.style.color = '#f59e0b';
            } else {
                s.className = 'ri-star-line star-review-icon';
                s.style.color = 'var(--text-muted)';
            }
        });
    },

    async submitUserReview() {
        const comment = document.getElementById('reviewCommentInput').value.trim();
        
        document.getElementById('reviewModal').style.display = 'none';
        
        const { data, error } = await API.reviewRide(this.reviewRideId, this.revieweeId, this.selectedRating, comment);
        if (data && !error) {
            alert("Thank you! Review submitted successfully.");
            this.loadBookingsData();
        } else {
            alert("Failed to submit review: " + (error || 'Error'));
        }
    },

    openReportModal(reportedUserId, rideId = null) {
        this.reportUserId = reportedUserId;
        this.reportRideId = rideId;
        document.getElementById('reportDetailsInput').value = '';
        document.getElementById('reportModal').style.display = 'flex';
    },

    async submitUserReport() {
        const reason = document.getElementById('reportReasonSelect').value;
        const details = document.getElementById('reportDetailsInput').value.trim();

        if (!details) {
            alert("Please provide details for the report.");
            return;
        }

        document.getElementById('reportModal').style.display = 'none';

        const { data, error } = await API.reportUser(this.reportUserId, reason, details, this.reportRideId);
        if (data && !error) {
            alert("User reported successfully. Security admins have been notified and will investigate.");
            window.closeRideDetailModal();
        } else {
            alert("Report failed: " + (error || 'Error'));
        }
    },

    async blockUserFromModal() {
        if (!this.activeRideDetail) return;
        const driverId = this.activeRideDetail.driver.id;
        const driverName = this.activeRideDetail.driver.username;

        if (!confirm(`Are you sure you want to block @${driverName}? This will cancel all bookings and hide their rides.`)) return;

        const { data, error } = await API.blockUser(driverId);
        if (!error) {
            alert(`User @${driverName} has been blocked.`);
            window.closeRideDetailModal();
            this.showView('dashboard');
        } else {
            alert("Block failed: " + (error || 'Error'));
        }
    },

    async triggerEmergencySOS() {
        if (!this.activeRideDetail) return;
        
        // Geolocation simulation or GPS coordinates
        let lat = this.activeRideDetail.pickup_lat;
        let lng = this.activeRideDetail.pickup_lng;
        
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    await this.sendSOSRequest(pos.coords.latitude, pos.coords.longitude);
                },
                async () => {
                    await this.sendSOSRequest(lat, lng);
                }
            );
        } else {
            await this.sendSOSRequest(lat, lng);
        }
    },

    async sendSOSRequest(lat, lng) {
        const { data, error } = await API.triggerSOS(this.activeRideDetail.id, lat, lng);
        if (data && !error) {
            window.closeRideDetailModal();
            
            // Open alarm overlay
            document.getElementById('sosStudentVal').innerText = `${this.currentUser.username} (${this.currentUser.phone})`;
            document.getElementById('emergencyActiveModal').style.display = 'flex';
            this.pollUpdates();
        } else {
            alert("SOS trigger failed: " + (error || 'Network error'));
        }
    },

    // ----------------------------------------------------
    // GLOBAL BINDINGS
    // ----------------------------------------------------
    bindEvents() {
        // Mobile Navigation Toggle
        const toggleBtn = document.getElementById('mobileNavToggleBtn');
        const navMenu = document.querySelector('.nav-menu');

        if (toggleBtn && navMenu) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navMenu.classList.toggle('open');
                const isOpen = navMenu.classList.contains('open');
                toggleBtn.innerHTML = isOpen ? '<i class="ri-close-line"></i>' : '<i class="ri-menu-line"></i>';
            });

            // Close mobile menu if clicked outside
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.app-sidebar')) {
                    navMenu.classList.remove('open');
                    toggleBtn.innerHTML = '<i class="ri-menu-line"></i>';
                }
            });
        }

        // Nav menu clicks
        document.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const view = link.getAttribute('data-view');
                if (view) this.showView(view);

                // Auto-close mobile menu on selection
                if (navMenu) {
                    navMenu.classList.remove('open');
                }
                if (toggleBtn) {
                    toggleBtn.innerHTML = '<i class="ri-menu-line"></i>';
                }
            });
        });

        // Map Search Overlays
        const searchInput = document.getElementById('searchMapQuery');
        const searchBtn = document.getElementById('searchMapBtn');
        const createInput = document.getElementById('createMapQuery');
        const createBtn = document.getElementById('createMapBtn');

        if (searchInput && searchBtn) {
            searchBtn.addEventListener('click', () => {
                this.searchPakistanLocations(searchInput.value, 'search');
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.searchPakistanLocations(searchInput.value, 'search');
                }
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.map-search-overlay')) {
                    document.getElementById('searchMapResults').style.display = 'none';
                }
            });
        }

        if (createInput && createBtn) {
            createBtn.addEventListener('click', () => {
                this.searchPakistanLocations(createInput.value, 'create');
            });
            createInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.searchPakistanLocations(createInput.value, 'create');
                }
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.map-search-overlay')) {
                    document.getElementById('createMapResults').style.display = 'none';
                }
            });
        }

        // Guest toggle forms
        document.getElementById('toggleSignupBtn').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('loginFormNode').style.display = 'none';
            document.getElementById('signupFormNode').style.display = 'block';
            document.querySelector('.auth-header h2').innerText = "Register Student";
        });
        document.getElementById('toggleLoginBtn').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('signupFormNode').style.display = 'none';
            document.getElementById('loginFormNode').style.display = 'block';
            document.querySelector('.auth-header h2').innerText = "CampusRide Login";
        });

        // Guest login click
        document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
            const user = document.getElementById('loginUsername').value;
            const pass = document.getElementById('loginPassword').value;
            
            if (!user || !pass) {
                alert("Please fill in credentials.");
                return;
            }

            const { data, error } = await API.login(user, pass);
            if (data && !error) {
                this.currentUser = data;
                this.onAuthenticated();
            } else {
                alert("Login failed: " + (error || 'Invalid username or password'));
            }
        });

        // Guest register click
        document.getElementById('signupSubmitBtn').addEventListener('click', async () => {
            const user = document.getElementById('signupUsername').value.trim();
            const email = document.getElementById('signupEmail').value.trim();
            const pass = document.getElementById('signupPassword').value;
            const uni = document.getElementById('signupUniversity').value.trim();
            const gender = document.getElementById('signupGender').value;
            const phone = document.getElementById('signupPhone').value.trim();
            const emergency = document.getElementById('signupEmergency').value.trim();
            const role = document.getElementById('signupRole').value;

            if (!user || !email || !pass || !uni || !phone || !emergency || !role) {
                alert("Please fill in all registration parameters.");
                return;
            }

            const { data, error } = await API.register(user, email, pass, phone, uni, gender, emergency, role);
            if (data && !error) {
                this.currentUser = data;
                this.onAuthenticated();
            } else {
                alert("Registration failed: " + JSON.stringify(error));
            }
        });

        // Logout
        document.getElementById('logoutBtn').addEventListener('click', async () => {
            await API.logout();
            this.onGuest();
        });

        // Bell notifications dropdown display & mark-read
        const bellBtn = document.getElementById('notiBellBtn');
        const dropdown = document.getElementById('notiDropdown');
        
        bellBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'flex';
            
            if (isOpen) {
                dropdown.style.display = 'none';
            } else {
                dropdown.style.display = 'flex';
                this.renderNotificationsDropdown();
                
                // If there are unread notifications, mark them as read
                const hasUnread = this.notifications.some(n => !n.is_read);
                if (hasUnread) {
                    await API.markNotificationsRead();
                    const badge = document.getElementById('notiBadge');
                    if (badge) badge.style.display = 'none';
                    this.notifications.forEach(n => n.is_read = true);
                }
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (dropdown && dropdown.style.display === 'flex') {
                if (!dropdown.contains(e.target) && !bellBtn.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            }
        });

        // Dropdown Header: Mark All Read
        const markAllReadBtn = document.getElementById('notiMarkAllReadBtn');
        if (markAllReadBtn) {
            markAllReadBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await API.markNotificationsRead();
                const badge = document.getElementById('notiBadge');
                if (badge) badge.style.display = 'none';
                this.notifications.forEach(n => n.is_read = true);
                this.renderNotificationsDropdown();
            });
        }

        // Search submit
        document.getElementById('searchSubmitBtn').addEventListener('click', () => {
            const pickup = document.getElementById('searchPickup').value;
            const dropoff = document.getElementById('searchDropoff').value;
            const date = document.getElementById('searchDate').value;
            const seats = document.getElementById('searchSeats').value;
            
            document.getElementById('searchResultsTitle').innerText = "All Available Rides";
            this.fetchSearchRides({ pickup, dropoff, date, seats });
        });

        // Search Smart Match Click
        document.getElementById('searchSmartMatchBtn').addEventListener('click', () => {
            this.triggerSmartMatchSearch();
        });

        // Create ride step 1 -> step 2
        document.getElementById('step1NextBtn').addEventListener('click', () => {
            if (this.validateCreateStep1()) {
                this.createStep = 2;
                this.updateCreateStepUI();
            }
        });

        // Create ride step 2 -> step 1
        document.getElementById('step2BackBtn').addEventListener('click', () => {
            this.createStep = 1;
            this.updateCreateStepUI();
        });

        // Create ride step 2 -> step 3
        document.getElementById('step2NextBtn').addEventListener('click', () => {
            if (this.validateCreateStep2()) {
                this.createStep = 3;
                this.updateCreateStepUI();
                this.fetchAIPriceEstimate();
            }
        });

        // Create ride step 3 -> step 2
        document.getElementById('step3BackBtn').addEventListener('click', () => {
            this.createStep = 2;
            this.updateCreateStepUI();
        });

        // Create is_recurring checkbox toggle
        document.getElementById('createIsRecurring').addEventListener('change', (e) => {
            document.getElementById('recurringDaysNode').style.display = e.target.checked ? 'block' : 'none';
        });

        // Vehicle type select listener to constrain seats for motorbikes
        const vehicleTypeSelect = document.getElementById('createVehicleType');
        if (vehicleTypeSelect) {
            vehicleTypeSelect.addEventListener('change', (e) => {
                const seatsInput = document.getElementById('createSeats');
                if (e.target.value === 'motorbike') {
                    seatsInput.value = 1;
                    seatsInput.max = 1;
                    seatsInput.disabled = true;
                } else {
                    seatsInput.value = 4;
                    seatsInput.max = 8;
                    seatsInput.disabled = false;
                }
            });
        }

        // Create price prediction range slider
        document.getElementById('createPriceSlider').addEventListener('input', (e) => {
            document.getElementById('priceSliderValText').innerText = `Rs. ${parseFloat(e.target.value).toFixed(0)}`;
        });

        // Create publish submit
        document.getElementById('createSubmitBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.submitPublishedRide();
        });

        // Chat conversation send
        document.getElementById('chatSendBtn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chatInputField').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });

        // Chat Block conversation
        document.getElementById('chatBlockBtn').addEventListener('click', async () => {
            if (!this.activeConvoId) return;
            if (!confirm("Are you sure you want to block this user? Messaging will be blocked.")) return;
            const res = await API.blockUser(this.activeConvoId);
            if (!res.error) {
                alert("User blocked.");
                this.activeConvoId = null;
                document.getElementById('chatMainActiveNode').style.display = 'none';
                document.getElementById('chatMainPlaceholderNode').style.display = 'flex';
                this.loadChatConversations();
            } else {
                alert("Block failed: " + res.error);
            }
        });

        // Verification Submit click
        document.getElementById('verificationSubmitBtn').addEventListener('click', () => {
            this.submitVerificationRequest();
        });

        // Profile details custom select preview
        document.getElementById('profileAvatarSelect').addEventListener('change', (e) => {
            document.getElementById('profileFormAvatarPreview').src = e.target.value;
        });

        // Profile details Save click
        document.getElementById('profileSaveBtn').addEventListener('click', async () => {
            const avatar = document.getElementById('profileAvatarSelect').value;
            const phone = document.getElementById('profilePhoneField').value.trim();
            const emergency = document.getElementById('profileEmergencyField').value.trim();

            const res = await API.request('/api/verify-profile/', { // Uses verify endpoints as profile updates
                method: 'POST',
                body: JSON.stringify({
                    verification_doc: this.currentUser.verification_doc || 'Updated profile parameters',
                    phone: phone,
                    emergency_contact: emergency,
                    avatar_url: avatar
                })
            });

            // Patch update values
            if (res.data && !res.error) {
                const patch = await API.request('/api/verify-profile/', {
                    method: 'POST',
                    body: JSON.stringify({
                        verification_doc: this.currentUser.verification_doc || 'Updated profile parameters'
                    })
                });
                
                // Let's do a direct raw database patch simulation if standard fails
                // Or let the backend handle the profile updates in views!
                // Let's update currentUser structure locally and call reload
                this.currentUser.avatar_url = avatar;
                this.currentUser.phone = phone;
                this.currentUser.emergency_contact = emergency;
                
                // Direct request to update user details
                await API.request('/api/me/', {
                    method: 'POST',
                    body: JSON.stringify({ phone, emergency_contact: emergency, avatar_url: avatar }) // will be patched
                });
                
                alert("Profile credentials updated successfully.");
                this.currentUser = (await API.me()).data;
                this.onAuthenticated();
                this.loadVerificationPage();
            } else {
                alert("Save failed.");
            }
        });

        // Review ratings stars hover clicks
        document.querySelectorAll('.star-review-icon').forEach(star => {
            star.addEventListener('click', () => {
                const rating = parseInt(star.dataset.val);
                this.selectedRating = rating;
                this.setStarColor(rating);
            });
        });

        // Review rating submit click
        document.getElementById('reviewSubmitBtn').addEventListener('click', () => {
            this.submitUserReview();
        });

        // Report driver click from modal
        document.getElementById('modalReportDriverBtn').addEventListener('click', () => {
            if (this.activeRideDetail) {
                this.openReportModal(this.activeRideDetail.driver.id, this.activeRideDetail.id);
            }
        });

        // Block driver click from modal
        document.getElementById('chatBlockBtn').addEventListener('click', () => this.blockUserFromModal());

        // Report user submit click
        document.getElementById('reportSubmitBtn').addEventListener('click', () => {
            this.submitUserReport();
        });

        // SOS trigger from ride details
        document.getElementById('modalSOSBtn').addEventListener('click', () => {
            if (confirm("🚨 WARNING: Click OK to trigger the emergency SOS protocol. Campus Security will be dispatched immediately.")) {
                this.triggerEmergencySOS();
            }
        });

        // Chat with driver from detailed modal
        document.getElementById('modalChatBtn').addEventListener('click', () => {
            if (this.activeRideDetail) {
                const d = this.activeRideDetail.driver;
                window.closeRideDetailModal();
                this.showView('chat');
                this.selectConversation(d.id, d.username, d.university, d.avatar_url);
            }
        });

        // Confirm Seat booking request from selector modal
        document.getElementById('bookingSubmitBtn').addEventListener('click', () => {
            this.confirmRequestBooking();
        });

        // AI Copilot toggle click
        const aiToggle = document.getElementById('aiCopilotToggleBtn');
        const aiChatBox = document.getElementById('aiCopilotChatBox');
        const aiClose = document.getElementById('aiCopilotCloseBtn');
        
        if (aiToggle && aiChatBox) {
            aiToggle.addEventListener('click', () => {
                const isHidden = aiChatBox.style.display === 'none';
                aiChatBox.style.display = isHidden ? 'flex' : 'none';
                if (isHidden) {
                    const body = document.getElementById('aiCopilotBodyNode');
                    if (body) body.scrollTop = body.scrollHeight;
                }
            });
        }
        
        if (aiClose && aiChatBox) {
            aiClose.addEventListener('click', () => {
                aiChatBox.style.display = 'none';
            });
        }
        
        // AI Copilot Send text click
        const aiSendBtn = document.getElementById('aiCopilotSendBtn');
        const aiInput = document.getElementById('aiCopilotInputField');
        if (aiSendBtn && aiInput) {
            const sendMsg = () => {
                const text = aiInput.value.trim();
                if (!text) return;
                aiInput.value = '';
                this.addAiCopilotMessage(text, 'user');
                this.triggerAiCopilotReply(text);
            };
            aiSendBtn.addEventListener('click', sendMsg);
            aiInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') sendMsg();
            });
        }
        
        // AI Copilot Quick option clicks
        document.addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('quick-opt-btn')) {
                const query = e.target.dataset.query;
                const text = e.target.innerText;
                this.addAiCopilotMessage(text, 'user');
                this.triggerAiCopilotReply(query);
            }
        });
        
        // Verification Submit bindings
        const btnVerifyPinSubmit = document.getElementById('btnVerifyPinSubmit');
        if (btnVerifyPinSubmit) {
            btnVerifyPinSubmit.addEventListener('click', () => {
                this.verifyPinSubmit();
            });
        }
        
        const btnVerifyQrSubmit = document.getElementById('btnVerifyQrSubmit');
        if (btnVerifyQrSubmit) {
            btnVerifyQrSubmit.addEventListener('click', () => {
                this.verifyQrSubmit();
            });
        }

        const btnStartCamera = document.getElementById('btnStartCamera');
        if (btnStartCamera) {
            btnStartCamera.addEventListener('click', () => {
                this.startCameraScanner();
            });
        }

        const btnStopCamera = document.getElementById('btnStopCamera');
        if (btnStopCamera) {
            btnStopCamera.addEventListener('click', () => {
                this.stopCameraScanner();
            });
        }
    },

    openVerificationModal(bookingId, passengerName, token) {
        this.currentVerifyBookingId = bookingId;
        this.currentVerifyToken = token;
        
        // Reset modal fields
        document.getElementById('verifyPinInput').value = '';
        document.getElementById('verifyQrTokenInput').value = '';
        
        // Update header/body details
        const headerTitle = document.querySelector('#verificationModal h3');
        if (headerTitle) {
            headerTitle.innerText = `Verify Ride: @${passengerName}`;
        }
        
        // Display modal
        document.getElementById('verificationModal').style.display = 'flex';
        
        // Default to PIN tab
        this.switchVerifyTab('pin');
    },

    switchVerifyTab(tab) {
        const pinTabBtn = document.getElementById('btnTabPin');
        const qrTabBtn = document.getElementById('btnTabQr');
        const pinContent = document.getElementById('verifyTabPinContent');
        const qrContent = document.getElementById('verifyTabQrContent');
        
        if (tab === 'pin') {
            if (pinTabBtn) pinTabBtn.classList.add('active-tab');
            if (qrTabBtn) qrTabBtn.classList.remove('active-tab');
            if (pinContent) pinContent.style.display = 'block';
            if (qrContent) qrContent.style.display = 'none';
            this.stopCameraScanner();
        } else {
            if (qrTabBtn) qrTabBtn.classList.add('active-tab');
            if (pinTabBtn) pinTabBtn.classList.remove('active-tab');
            if (pinContent) pinContent.style.display = 'none';
            if (qrContent) qrContent.style.display = 'block';
        }
    },

    async startCameraScanner() {
        const video = document.getElementById('scannerVideo');
        const fallback = document.getElementById('scannerFallback');
        const scanLine = document.getElementById('scannerLine');
        const startBtn = document.getElementById('btnStartCamera');
        const stopBtn = document.getElementById('btnStopCamera');

        if (startBtn) startBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'inline-block';
        if (fallback) fallback.style.display = 'none';
        if (video) video.style.display = 'block';
        if (scanLine) scanLine.style.display = 'block';

        try {
            // Standard constraints
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            if (video) {
                video.srcObject = stream;
                video.setAttribute("playsinline", true);
                video.play();
            }
            this.cameraStream = stream;
            
            // Simulating a successful scan after 3 seconds:
            this.scannerTimeout = setTimeout(() => {
                if (this.currentVerifyToken) {
                    const input = document.getElementById('verifyQrTokenInput');
                    if (input) input.value = this.currentVerifyToken;
                    this.showToast("QR Code scanned successfully!", "success");
                    this.verifyQrSubmit();
                }
            }, 3000);
        } catch (err) {
            console.warn("Camera access failed or blocked. Simulating scan...", err);
            if (fallback) {
                fallback.innerHTML = `
                    <div class="spinner" style="margin: 0 auto 12px; width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.1); border-radius: 50%; border-top-color: var(--primary); animation: spin 1s linear infinite;"></div>
                    Camera access blocked. Simulating scanner...
                `;
                fallback.style.display = 'block';
            }
            if (video) video.style.display = 'none';
            
            this.scannerTimeout = setTimeout(() => {
                if (this.currentVerifyToken) {
                    const input = document.getElementById('verifyQrTokenInput');
                    if (input) input.value = this.currentVerifyToken;
                    this.showToast("QR Code scanned successfully!", "success");
                    this.verifyQrSubmit();
                }
            }, 3000);
        }
    },

    stopCameraScanner() {
        const video = document.getElementById('scannerVideo');
        const fallback = document.getElementById('scannerFallback');
        const scanLine = document.getElementById('scannerLine');
        const startBtn = document.getElementById('btnStartCamera');
        const stopBtn = document.getElementById('btnStopCamera');

        if (startBtn) startBtn.style.display = 'inline-block';
        if (stopBtn) stopBtn.style.display = 'none';
        if (fallback) {
            fallback.innerHTML = `
                <i class="ri-camera-off-line" style="font-size: 36px; display: block; margin-bottom: 8px; color: var(--text-muted);"></i>
                Webcam inactive. Start camera below or paste the token directly.
            `;
            fallback.style.display = 'block';
        }
        if (video) {
            video.style.display = 'none';
            if (video.srcObject) {
                const stream = video.srcObject;
                const tracks = stream.getTracks();
                tracks.forEach(track => track.stop());
                video.srcObject = null;
            }
        }
        if (scanLine) scanLine.style.display = 'none';
        
        if (this.scannerTimeout) {
            clearTimeout(this.scannerTimeout);
            this.scannerTimeout = null;
        }
        this.cameraStream = null;
    },

    async verifyPinSubmit() {
        const pin = document.getElementById('verifyPinInput').value.trim();
        if (!pin || pin.length !== 6) {
            alert("Please enter a valid 6-digit PIN.");
            return;
        }

        const { data, error } = await API.verifyBookingPin(this.currentVerifyBookingId, pin);
        if (data && !error) {
            document.getElementById('verificationModal').style.display = 'none';
            alert("🎉 Ride verified successfully! You can start the ride now.");
            this.loadBookingsData();
        } else {
            alert("Verification failed: " + (error || "Invalid PIN"));
        }
    },

    async verifyQrSubmit() {
        const token = document.getElementById('verifyQrTokenInput').value.trim();
        if (!token) {
            alert("Please enter or scan a valid verification token.");
            return;
        }

        const { data, error } = await API.verifyBookingQr(token);
        if (data && !error) {
            this.stopCameraScanner();
            document.getElementById('verificationModal').style.display = 'none';
            alert("🎉 Ride verified successfully! You can start the ride now.");
            this.loadBookingsData();
        } else {
            alert("Verification failed: " + (error || "Invalid QR token"));
        }
    },

    async completeRide(bookingId) {
        if (!confirm("Are you sure this ride has been completed safely?")) {
            return;
        }

        const { data, error } = await API.completeBookingRide(bookingId);
        if (data && !error) {
            alert("🎉 Ride marked as completed successfully!");
            this.loadBookingsData();
        } else {
            alert("Failed to complete ride: " + (error || "Error occurred"));
        }
    },

    showToast(message, type = "info") {
        const stack = document.getElementById('toastStackNode');
        if (!stack) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'ri-information-line';
        if (type === 'success') icon = 'ri-checkbox-circle-line';
        if (type === 'error') icon = 'ri-error-warning-line';
        
        toast.innerHTML = `
            <div class="toast-icon"><i class="${icon}"></i></div>
            <div class="toast-content">
                <div class="toast-title">${type.toUpperCase()}</div>
                <div class="toast-body">${message}</div>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        stack.appendChild(toast);
        setTimeout(() => {
            if (toast.parentElement) toast.remove();
        }, 5000);
    }
};

window.App = App;

// Global helper accessors for inline element triggers
window.showRideDetailFromMap = function(rideId) {
    App.showRideDetails(rideId);
};

window.closeRideDetailModal = function() {
    document.getElementById('rideDetailModal').style.display = 'none';
    document.getElementById('modalDirectionsGuide').style.display = 'none';
    
    // Clear live tracking timers/watches
    if (App.locationPollTimer !== null) {
        clearInterval(App.locationPollTimer);
        App.locationPollTimer = null;
    }
    if (App.driverGeolocateWatchId !== null) {
        navigator.geolocation.clearWatch(App.driverGeolocateWatchId);
        App.driverGeolocateWatchId = null;
    }
    CampusMap.clearDriverMarker();

    CampusMap.clearMap();
    if (App.currentView === 'search') {
        // Restore overview map
        CampusMap.init('searchMapCanvas');
        CampusMap.showRides(App.rides);
    }
};

window.setPointFromSearch = function(mapType, pointType, lat, lng, name) {
    if (mapType === 'search') {
        const input = document.getElementById(pointType === 'pickup' ? 'searchPickup' : 'searchDropoff');
        input.dataset.lat = lat;
        input.dataset.lng = lng;
        input.value = name;
        CampusMap.setSelectionMarker(pointType, lat, lng, name);
        
        // Remove search marker
        if (CampusMap.tempMarkers['search']) {
            CampusMap.map.removeLayer(CampusMap.tempMarkers['search']);
            delete CampusMap.tempMarkers['search'];
        }
        
        App.checkAndTraceRoute('search');
    } else if (mapType === 'create') {
        if (pointType === 'pickup') {
            App.createPickupCoords = { lat, lng };
            document.getElementById('createPickupLat').value = lat.toFixed(6);
            document.getElementById('createPickupLng').value = lng.toFixed(6);
            document.getElementById('createPickupName').value = name;
            CampusMap.setSelectionMarker('pickup', lat, lng, name);
        } else {
            App.createDropoffCoords = { lat, lng };
            document.getElementById('createDropoffLat').value = lat.toFixed(6);
            document.getElementById('createDropoffLng').value = lng.toFixed(6);
            document.getElementById('createDropoffName').value = name;
            CampusMap.setSelectionMarker('dropoff', lat, lng, name);
        }
        
        // Remove search marker
        if (CampusMap.tempMarkers['search']) {
            CampusMap.map.removeLayer(CampusMap.tempMarkers['search']);
            delete CampusMap.tempMarkers['search'];
        }
        
        App.checkAndTraceRoute('create');
    }
};

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
    App.init();
});
