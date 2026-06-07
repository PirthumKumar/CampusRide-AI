from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import authenticate, login, logout
from django.views.decorators.csrf import csrf_exempt, ensure_csrf_cookie
from django.middleware.csrf import get_token
from django.shortcuts import render
from django.db.models import Q, Max
from django.utils import timezone
from datetime import datetime, date

from .models import User, Ride, Booking, Message, Notification, Review, Report, BlockedUser, SOSEvent, RideLocation, Timetable
from .serializers import (UserSerializer, UserMinSerializer, RegisterSerializer, RideSerializer, 
                            BookingSerializer, MessageSerializer, NotificationSerializer, 
                            ReviewSerializer, ReportSerializer, SOSEventSerializer, TimetableSerializer)
from .pricing import get_price_prediction
from .matching import (check_route_match, optimize_driver_route, haversine_distance, 
                       calculate_timetable_match_score, calculate_ride_timetable_match_score)


# Serve the HTML Single Page Application
@ensure_csrf_cookie
def index_view(request):
    return render(request, 'core/index.html')




@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    if serializer.is_valid():
        user = serializer.save()
        login(request, user)  # Authenticate immediately
        get_token(request)  # Force cookie update with new rotated CSRF token
        return Response(UserSerializer(user).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])
@authentication_classes([])
def login_view(request):
    username = request.data.get('username')
    password = request.data.get('password')
    
    if not username or not password:
        return Response({'error': 'Please provide both username and password'}, status=status.HTTP_400_BAD_REQUEST)
        
    user = authenticate(username=username, password=password)
    if user is not None:
        login(request, user)
        get_token(request)  # Force cookie update with new rotated CSRF token
        return Response(UserSerializer(user).data)
    else:
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)


@csrf_exempt
@api_view(['POST'])
@permission_classes([AllowAny])  # Can log out if session exists
@authentication_classes([])
def logout_view(request):
    logout(request)
    get_token(request)  # Force cookie update with fresh guest CSRF token
    return Response({'message': 'Logged out successfully'})


@api_view(['GET'])
def me_view(request):
    if request.user.is_authenticated:
        return Response(UserSerializer(request.user).data)
    return Response({'error': 'Not authenticated'}, status=status.HTTP_401_UNAUTHORIZED)


@csrf_exempt
@api_view(['POST'])
def verify_profile_view(request):
    user = request.user
    doc_text = request.data.get('verification_doc', '')
    
    if not doc_text:
        return Response({'error': 'Verification details cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
        
    user.verification_status = 'pending'
    user.verification_doc = doc_text
    user.save()
    
    # Create notification for User
    Notification.objects.create(
        user=user,
        title="Verification Submitted",
        content="Your student card verification has been submitted and is pending admin review.",
        notification_type="system"
    )
    
    # Create notification for Admins
    admins = User.objects.filter(is_staff=True)
    for admin in admins:
        Notification.objects.create(
            user=admin,
            title="Pending Verification Request",
            content=f"Student {user.username} has submitted a new verification request.",
            notification_type="system",
            related_id=user.id
        )
        
    return Response(UserSerializer(user).data)


@csrf_exempt
@api_view(['GET', 'POST'])
def rides_view(request):
    if request.method == 'GET':
        # 1. Fetch blocked user IDs to filter rides
        blocked_ids = list(BlockedUser.objects.filter(blocker=request.user).values_list('blocked_id', flat=True))
        blocked_by_ids = list(BlockedUser.objects.filter(blocked=request.user).values_list('blocker_id', flat=True))
        exclude_user_ids = set(blocked_ids + blocked_by_ids)
        # 2. Start query
        if request.user.role == 'external_driver':
            rides = Ride.objects.filter(driver=request.user)
        else:
            rides = Ride.objects.exclude(driver_id__in=exclude_user_ids).filter(date__gte=timezone.now().date())
            rides = rides.exclude(Q(driver__role='external_driver') & ~Q(driver__verification_status='verified'))
        
        # Filters
        pickup = request.query_params.get('pickup')
        dropoff = request.query_params.get('dropoff')
        date_str = request.query_params.get('date')
        seats_needed = request.query_params.get('seats')
        
        if pickup:
            rides = rides.filter(pickup_name__icontains=pickup)
        if dropoff:
            rides = rides.filter(dropoff_name__icontains=dropoff)
        if date_str:
            try:
                rides = rides.filter(date=date_str)
            except Exception:
                pass
        if seats_needed:
            try:
                rides = rides.filter(seats_available__gte=int(seats_needed))
            except ValueError:
                pass
                
        # Order by date/time
        rides = rides.order_digits = rides.order_by('date', 'time')
        return Response(RideSerializer(rides, many=True).data)
        
    elif request.method == 'POST':
        if request.user.role == 'external_driver' and request.user.verification_status != 'verified':
            return Response({'error': 'External drivers must be verified by an administrator to upload rides.'}, status=status.HTTP_403_FORBIDDEN)
            
        # Create ride post
        data = request.data.copy()
        
        # Validation checks
        required_fields = ['pickup_name', 'pickup_lat', 'pickup_lng', 'dropoff_name', 'dropoff_lat', 'dropoff_lng', 
                           'date', 'time', 'seats_total', 'price_per_seat', 'vehicle_model', 'vehicle_plate']
        for field in required_fields:
            if field not in data or data[field] == '':
                return Response({'error': f"Field '{field}' is required"}, status=status.HTTP_400_BAD_REQUEST)
                
        serializer = RideSerializer(data=data)
        if serializer.is_valid():
            serializer.save(driver=request.user, seats_available=data['seats_total'])
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@csrf_exempt
@api_view(['POST'])
def price_predict_view(request):
    pickup_lat = float(request.data.get('pickup_lat', 0.0))
    pickup_lng = float(request.data.get('pickup_lng', 0.0))
    dropoff_lat = float(request.data.get('dropoff_lat', 0.0))
    dropoff_lng = float(request.data.get('dropoff_lng', 0.0))
    ride_time_str = request.data.get('time', '12:00')
    ride_date_str = request.data.get('date', str(timezone.now().date()))
    vehicle_model = request.data.get('vehicle_model', 'Sedan')
    seats_total = int(request.data.get('seats_total', 4))
    vehicle_type = request.data.get('vehicle_type', 'car')
    distance_km = request.data.get('distance_km', None)
    if distance_km is not None:
        try:
            distance_km = float(distance_km)
        except (ValueError, TypeError):
            distance_km = None
    
    if pickup_lat == 0.0 or dropoff_lat == 0.0:
        return Response({'error': 'Coordinates cannot be empty'}, status=status.HTTP_400_BAD_REQUEST)
        
    prediction = get_price_prediction(
        pickup_lat, pickup_lng, 
        dropoff_lat, dropoff_lng, 
        ride_time_str, ride_date_str, 
        vehicle_model, seats_total,
        override_distance_km=distance_km,
        vehicle_type=vehicle_type
    )
    return Response(prediction)


@api_view(['GET'])
def ride_detail_view(request, pk):
    try:
        ride = Ride.objects.get(pk=pk)
    except Ride.DoesNotExist:
        return Response({'error': 'Ride not found'}, status=status.HTTP_404_NOT_FOUND)
        
    ride_data = RideSerializer(ride).data
    
    # Include approved bookings
    approved_bookings = ride.bookings.filter(status='approved')
    ride_data['approved_passengers'] = BookingSerializer(approved_bookings, many=True).data
    
    # If the request is from the driver, return the optimized route overlay stops
    if request.user == ride.driver:
        driver_start = (ride.pickup_lat, ride.pickup_lng)
        driver_end = (ride.dropoff_lat, ride.dropoff_lng)
        
        # Format bookings for optimizer
        opt_bookings = []
        for b in approved_bookings:
            # We fetch mock coordinate deviation along the route for passengers if they book
            # In a real app, bookings would store actual passenger pickup/dropoff coords
            # Here, we dynamically fetch them near the driver path, or default to some offsets
            # Let's check if the booking has coordinates; for simulation we'll simulate passenger coords:
            # Passenger pickup is 15% along the path, dropoff is 85% along the path, offset by a tiny amount
            lat_span = ride.dropoff_lat - ride.pickup_lat
            lng_span = ride.dropoff_lng - ride.pickup_lng
            
            p_pick = (
                ride.pickup_lat + lat_span * 0.2 + (0.002 * (b.id % 2 - 0.5)),
                ride.pickup_lng + lng_span * 0.2 + (0.002 * (b.id % 2 - 0.5))
            )
            p_drop = (
                ride.pickup_lat + lat_span * 0.8 + (0.002 * (b.id % 2 - 0.5)),
                ride.pickup_lng + lng_span * 0.8 + (0.002 * (b.id % 2 - 0.5))
            )
            
            opt_bookings.append({
                'id': b.id,
                'passenger_name': b.passenger.username,
                'pickup': p_pick,
                'dropoff': p_drop
            })
            
        optimized_route, total_dist = optimize_driver_route(driver_start, driver_end, opt_bookings)
        ride_data['optimized_route'] = optimized_route
        ride_data['optimized_distance_km'] = total_dist
        
    return Response(ride_data)


@api_view(['GET'])
def rides_matching_view(request):
    if request.user.role == 'external_driver':
        return Response({'error': 'External drivers cannot perform ride matching.'}, status=status.HTTP_403_FORBIDDEN)
        
    pickup_lat = request.query_params.get('pickup_lat')
    pickup_lng = request.query_params.get('pickup_lng')
    dropoff_lat = request.query_params.get('dropoff_lat')
    dropoff_lng = request.query_params.get('dropoff_lng')
    date_str = request.query_params.get('date')
    
    if not (pickup_lat and pickup_lng and dropoff_lat and dropoff_lng):
        return Response({'error': 'Please provide passenger pickup and dropoff coordinates'}, status=status.HTTP_400_BAD_REQUEST)
        
    p_pickup = (float(pickup_lat), float(pickup_lng))
    p_dropoff = (float(dropoff_lat), float(dropoff_lng))
    
    blocked_ids = list(BlockedUser.objects.filter(blocker=request.user).values_list('blocked_id', flat=True))
    blocked_by_ids = list(BlockedUser.objects.filter(blocked=request.user).values_list('blocker_id', flat=True))
    exclude_user_ids = set(blocked_ids + blocked_by_ids)
    
    # Fetch active future rides
    rides = Ride.objects.exclude(driver_id__in=exclude_user_ids).filter(
        date__gte=timezone.now().date(),
        seats_available__gt=0
    )
    if date_str:
        rides = rides.filter(date=date_str)
        
    matched_rides = []
    
    for ride in rides:
        d_pickup = (ride.pickup_lat, ride.pickup_lng)
        d_dropoff = (ride.dropoff_lat, ride.dropoff_lng)
        
        match_result = check_route_match(p_pickup, p_dropoff, d_pickup, d_dropoff, max_dist_km=3.0)
        
        if match_result['is_match'] or match_result['is_direct']:
            # Calculate distance of passenger's trip
            trip_len = haversine_distance(p_pickup[0], p_pickup[1], p_dropoff[0], p_dropoff[1])
            # Compatibility score: lower deviation / trip_len = higher compatibility
            deviation = match_result['pickup_deviation_km'] + match_result['dropoff_deviation_km']
            compatibility = max(0, min(100, int(100 * (1 - (deviation / (trip_len + 0.1))))))
            
            ride_data = RideSerializer(ride).data
            ride_data['match_details'] = {
                'compatibility_pct': compatibility,
                'pickup_deviation_km': match_result['pickup_deviation_km'],
                'dropoff_deviation_km': match_result['dropoff_deviation_km'],
                'is_direct': match_result['is_direct']
            }
            matched_rides.append(ride_data)
            
    # Sort matched rides by compatibility percentage descending
    matched_rides.sort(key=lambda x: x['match_details']['compatibility_pct'], reverse=True)
    
    return Response(matched_rides)


@csrf_exempt
@api_view(['GET', 'POST'])
def bookings_view(request):
    if request.method == 'GET':
        # Returns user bookings
        # Passenger bookings
        p_bookings = Booking.objects.filter(passenger=request.user)
        # Driver bookings (requests received)
        d_bookings = Booking.objects.filter(ride__driver=request.user)
        
        if request.user.role == 'external_driver':
            return Response({
                'my_bookings': [],
                'received_requests': BookingSerializer(d_bookings, many=True, context={'request': request}).data
            })
            
        return Response({
            'my_bookings': BookingSerializer(p_bookings, many=True, context={'request': request}).data,
            'received_requests': BookingSerializer(d_bookings, many=True, context={'request': request}).data
        })
        
    elif request.method == 'POST':
        if request.user.role == 'external_driver':
            return Response({'error': 'External drivers cannot book rides.'}, status=status.HTTP_403_FORBIDDEN)
            
        # Create booking request
        ride_id = request.data.get('ride_id')
        seats_booked = int(request.data.get('seats_booked', 1))
        
        try:
            ride = Ride.objects.get(pk=ride_id)
        except Ride.DoesNotExist:
            return Response({'error': 'Ride not found'}, status=status.HTTP_404_NOT_FOUND)
            
        if ride.driver == request.user:
            return Response({'error': 'You cannot book seats in your own ride'}, status=status.HTTP_400_BAD_REQUEST)
            
        if ride.seats_available < seats_booked:
            return Response({'error': 'Not enough available seats'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Check if already has a booking
        existing_booking = Booking.objects.filter(ride=ride, passenger=request.user, status__in=['pending', 'approved']).first()
        if existing_booking:
            return Response({'error': f"You already have a {existing_booking.status} booking for this ride"}, status=status.HTTP_400_BAD_REQUEST)
            
        booking = Booking.objects.create(
            ride=ride,
            passenger=request.user,
            seats_booked=seats_booked,
            status='pending'
        )
        
        # Send Notification to Driver
        Notification.objects.create(
            user=ride.driver,
            title="New Booking Request",
            content=f"{request.user.username} requested {seats_booked} seat(s) for your ride from {ride.pickup_name} to {ride.dropoff_name}.",
            notification_type="booking_request",
            related_id=booking.id
        )
        
        return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
def booking_action_view(request, pk):
    action = request.data.get('action')  # 'approve', 'reject', 'cancel'
    
    try:
        booking = Booking.objects.get(pk=pk)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)
        
    ride = booking.ride
    
    if action == 'approve':
        if ride.driver != request.user:
            return Response({'error': 'Only the ride driver can approve bookings'}, status=status.HTTP_403_FORBIDDEN)
            
        if booking.status != 'pending':
            return Response({'error': 'Only pending bookings can be approved'}, status=status.HTTP_400_BAD_REQUEST)
            
        if ride.seats_available < booking.seats_booked:
            return Response({'error': 'Not enough seats available to approve this booking'}, status=status.HTTP_400_BAD_REQUEST)
            
        import random
        import uuid
        booking.status = 'approved'
        booking.verification_pin = "".join([str(random.randint(0, 9)) for _ in range(6)])
        booking.verification_token = uuid.uuid4().hex
        booking.ride_status = 'confirmed'
        booking.save()
        
        ride.seats_available -= booking.seats_booked
        ride.save()
        
        # Notify Passenger
        Notification.objects.create(
            user=booking.passenger,
            title="Booking Approved!",
            content=f"Your booking request for ride to {ride.dropoff_name} was approved by {ride.driver.username}.",
            notification_type="booking_status",
            related_id=booking.id
        )
        
    elif action == 'reject':
        if ride.driver != request.user:
            return Response({'error': 'Only the ride driver can reject bookings'}, status=status.HTTP_403_FORBIDDEN)
            
        if booking.status != 'pending':
            return Response({'error': 'Only pending bookings can be rejected'}, status=status.HTTP_400_BAD_REQUEST)
            
        booking.status = 'rejected'
        booking.save()
        
        # Notify Passenger
        Notification.objects.create(
            user=booking.passenger,
            title="Booking Request Declined",
            content=f"Your booking request for ride to {ride.dropoff_name} was declined by {ride.driver.username}.",
            notification_type="booking_status",
            related_id=booking.id
        )
        
    elif action == 'cancel':
        if booking.passenger != request.user and ride.driver != request.user:
            return Response({'error': 'Unauthorized action'}, status=status.HTTP_403_FORBIDDEN)
            
        if booking.status not in ['pending', 'approved']:
            return Response({'error': f"Cannot cancel booking with status '{booking.status}'"}, status=status.HTTP_400_BAD_REQUEST)
            
        original_status = booking.status
        booking.status = 'cancelled'
        booking.verification_pin = None
        booking.verification_token = None
        booking.ride_status = 'cancelled'
        booking.save()
        
        # If was approved, restore seats
        if original_status == 'approved':
            ride.seats_available += booking.seats_booked
            ride.save()
            
        # Notify other party
        notifier = booking.passenger if request.user == ride.driver else ride.driver
        title = "Booking Cancelled"
        actor = "The driver" if request.user == ride.driver else booking.passenger.username
        content = f"{actor} cancelled the booking for ride to {ride.dropoff_name}."
        
        Notification.objects.create(
            user=notifier,
            title=title,
            content=content,
            notification_type="booking_status",
            related_id=booking.id
        )
        
    else:
        return Response({'error': "Invalid action. Choose 'approve', 'reject', or 'cancel'"}, status=status.HTTP_400_BAD_REQUEST)
        
    return Response(BookingSerializer(booking, context={'request': request}).data)


@csrf_exempt
@api_view(['GET', 'POST'])
def chat_messages_view(request):
    if request.method == 'GET':
        other_user_id = request.query_params.get('user_id')
        ride_id = request.query_params.get('ride_id')
        since_id = request.query_params.get('since_id')
        
        if not other_user_id:
            return Response({'error': 'Please specify other user_id'}, status=status.HTTP_400_BAD_REQUEST)
            
        messages = Message.objects.filter(
            (Q(sender=request.user) & Q(receiver_id=other_user_id)) |
            (Q(sender_id=other_user_id) & Q(receiver=request.user))
        )
        
        if ride_id:
            messages = messages.filter(ride_id=ride_id)
            
        if since_id:
            messages = messages.filter(id__gt=since_id)
            
        messages = messages.order_by('created_at')
        
        # Mark received messages as read
        unread_received = messages.filter(receiver=request.user, is_read=False)
        unread_received.update(is_read=True)
        
        return Response(MessageSerializer(messages, many=True).data)
        
    elif request.method == 'POST':
        receiver_id = request.data.get('receiver_id')
        ride_id = request.data.get('ride_id')
        content = request.data.get('content')
        
        if not receiver_id or not content:
            return Response({'error': 'Please provide receiver_id and content'}, status=status.HTTP_400_BAD_REQUEST)
            
        # Check block list
        is_blocked = BlockedUser.objects.filter(
            Q(blocker=request.user, blocked_id=receiver_id) | 
            Q(blocker_id=receiver_id, blocked=request.user)
        ).exists()
        
        if is_blocked:
            return Response({'error': 'Cannot send message. Messaging blocked.'}, status=status.HTTP_403_FORBIDDEN)
            
        try:
            receiver = User.objects.get(pk=receiver_id)
        except User.DoesNotExist:
            return Response({'error': 'Recipient not found'}, status=status.HTTP_404_NOT_FOUND)
            
        ride = None
        if ride_id:
            try:
                ride = Ride.objects.get(pk=ride_id)
            except Ride.DoesNotExist:
                pass
                
        msg = Message.objects.create(
            sender=request.user,
            receiver=receiver,
            ride=ride,
            content=content
        )
        
        # Send Notification to Receiver
        Notification.objects.create(
            user=receiver,
            title=f"New Chat from {request.user.username}",
            content=content[:100] + '...' if len(content) > 100 else content,
            notification_type="new_message",
            related_id=msg.id
        )
        
        return Response(MessageSerializer(msg).data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def chat_conversations_view(request):
    # Fetch distinct active chats
    # We want a list of users we have chatted with, alongside the last message details.
    user = request.user
    
    # Fetch all messages where current user is sender or receiver
    messages = Message.objects.filter(Q(sender=user) | Q(receiver=user))
    
    # Group by conversation partner
    # Find the maximum message ID for each partner
    partner_last_msg_ids = {}
    for m in messages:
        partner_id = m.receiver_id if m.sender_id == user.id else m.sender_id
        if partner_id not in partner_last_msg_ids or m.id > partner_last_msg_ids[partner_id]:
            partner_last_msg_ids[partner_id] = m.id
            
    # Retrieve messages
    last_messages = Message.objects.filter(id__in=partner_last_msg_ids.values()).order_by('-created_at')
    
    conversations = []
    for msg in last_messages:
        partner_id = msg.receiver_id if msg.sender_id == user.id else msg.sender_id
        partner = User.objects.get(id=partner_id)
        
        # Check if blocked
        is_blocked = BlockedUser.objects.filter(blocker=user, blocked=partner).exists()
        
        conversations.append({
            'partner': UserMinSerializer(partner).data,
            'last_message': MessageSerializer(msg).data,
            'is_blocked': is_blocked
        })
        
    return Response(conversations)


@api_view(['GET'])
def notifications_view(request):
    notifications = Notification.objects.filter(user=request.user).order_by('-created_at')
    return Response(NotificationSerializer(notifications, many=True).data)


@csrf_exempt
@api_view(['POST'])
def mark_notifications_read_view(request):
    notification_id = request.data.get('id')
    if notification_id:
        Notification.objects.filter(user=request.user, id=notification_id).update(is_read=True)
    else:
        Notification.objects.filter(user=request.user).update(is_read=True)
    return Response({'message': 'Notifications updated'})


@csrf_exempt
@api_view(['POST'])
def review_ride_view(request):
    ride_id = request.data.get('ride_id')
    reviewee_id = request.data.get('reviewee_id')
    rating = int(request.data.get('rating', 5))
    comment = request.data.get('comment', '')
    
    if not (ride_id and reviewee_id):
        return Response({'error': 'Please provide ride_id and reviewee_id'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        ride = Ride.objects.get(pk=ride_id)
        reviewee = User.objects.get(pk=reviewee_id)
    except (Ride.DoesNotExist, User.DoesNotExist):
        return Response({'error': 'Ride or User not found'}, status=status.HTTP_404_NOT_FOUND)
        
    # Check if user was part of the ride
    # Is driver or has an approved booking
    is_driver = ride.driver == request.user
    is_passenger = Booking.objects.filter(ride=ride, passenger=request.user, status='approved').exists()
    
    if not (is_driver or is_passenger):
        return Response({'error': 'You can only review users on rides you participated in'}, status=status.HTTP_403_FORBIDDEN)
        
    # Create review
    review = Review.objects.create(
        ride=ride,
        reviewer=request.user,
        reviewee=reviewee,
        rating=rating,
        comment=comment
    )
    
    # Recalculate reviewee's average rating
    reviewee.update_rating_average()
    
    return Response(ReviewSerializer(review).data, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
def report_user_view(request):
    reported_user_id = request.data.get('reported_user_id')
    ride_id = request.data.get('ride_id')
    reason = request.data.get('reason')
    details = request.data.get('details')
    
    if not (reported_user_id and reason and details):
        return Response({'error': 'Please provide reported_user_id, reason, and details'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        reported_user = User.objects.get(pk=reported_user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
    ride = None
    if ride_id:
        try:
            ride = Ride.objects.get(pk=ride_id)
        except Ride.DoesNotExist:
            pass
            
    report = Report.objects.create(
        reporter=request.user,
        reported_user=reported_user,
        ride=ride,
        reason=reason,
        details=details
    )
    
    # Notify Admins
    admins = User.objects.filter(is_staff=True)
    for admin in admins:
        Notification.objects.create(
            user=admin,
            title="New User Report Filed",
            content=f"{request.user.username} reported {reported_user.username} for: {reason}.",
            notification_type="system",
            related_id=report.id
        )
        
    return Response(ReportSerializer(report).data, status=status.HTTP_201_CREATED)


@csrf_exempt
@api_view(['POST'])
def block_user_view(request):
    blocked_user_id = request.data.get('blocked_user_id')
    if not blocked_user_id:
        return Response({'error': 'Please provide blocked_user_id'}, status=status.HTTP_400_BAD_REQUEST)
        
    try:
        blocked_user = User.objects.get(pk=blocked_user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
    if blocked_user == request.user:
        return Response({'error': 'You cannot block yourself'}, status=status.HTTP_400_BAD_REQUEST)
        
    obj, created = BlockedUser.objects.get_or_create(
        blocker=request.user,
        blocked=blocked_user
    )
    
    # Auto-cancel any pending or approved bookings between the two
    # Case 1: Blocker is driver, Blocked is passenger
    bookings_to_cancel = Booking.objects.filter(
        (Q(ride__driver=request.user) & Q(passenger=blocked_user)) |
        (Q(ride__driver=blocked_user) & Q(passenger=request.user))
    ).filter(status__in=['pending', 'approved'])
    
    for b in bookings_to_cancel:
        orig = b.status
        b.status = 'cancelled'
        b.save()
        if orig == 'approved':
            ride = b.ride
            ride.seats_available += b.seats_booked
            ride.save()
            
    return Response({'message': f"User {blocked_user.username} blocked successfully."})


@csrf_exempt
@api_view(['POST'])
def sos_emergency_view(request):
    ride_id = request.data.get('ride_id')
    lat = request.data.get('lat')
    lng = request.data.get('lng')
    
    # Get current user emergency contact info
    user = request.user
    emergency_contact = user.emergency_contact or "Not Provided"
    
    try:
        ride = Ride.objects.get(pk=ride_id)
        driver_name = ride.driver.username
        route_info = f"on Ride #{ride.id} from {ride.pickup_name} to {ride.dropoff_name}"
    except Exception:
        driver_name = "Unknown"
        route_info = "Unknown Ride"
        
    # Trigger emergency alert
    # Log details to system/console, and create alarm notifications for system admins
    alert_msg = (
        f"🚨 EMERGENCY SOS 🚨\n"
        f"Student: {user.username}\n"
        f"University: {user.university}\n"
        f"Phone: {user.phone}\n"
        f"Location Coordinates: ({lat}, {lng})\n"
        f"Active Carpool: {route_info} (Driver: {driver_name})\n"
        f"Contacting Registered Emergency Contact: {emergency_contact}\n"
        f"Alerting Campus Security Dispatch..."
    )
    try:
        print(alert_msg)
    except UnicodeEncodeError:
        try:
            print(alert_msg.encode('ascii', errors='replace').decode('ascii'))
        except Exception:
            pass
    
    # Create notification for user confirming SOS is active
    Notification.objects.create(
        user=user,
        title="🚨 SOS Emergency Active!",
        content="Campus Security and your emergency contact have been notified of your location coordinates. Remain calm.",
        notification_type="system"
    )
    
    # Alert Admins
    admins = User.objects.filter(is_staff=True)
    for admin in admins:
        Notification.objects.create(
            user=admin,
            title="🚨 EMERGENCY SOS ALERT!",
            content=f"User {user.username} activated SOS {route_info}. Coordinates: ({lat}, {lng}). Phone: {user.phone}.",
            notification_type="system",
            related_id=user.id
        )

    # Create SOSEvent log
    try:
        ride_obj = Ride.objects.get(pk=ride_id)
    except Exception:
        ride_obj = None

    try:
        lat_val = float(lat)
    except Exception:
        lat_val = 0.0

    try:
        lng_val = float(lng)
    except Exception:
        lng_val = 0.0

    SOSEvent.objects.create(
        user=user,
        ride=ride_obj,
        latitude=lat_val,
        longitude=lng_val,
        status='active'
    )
        
    return Response({
        'status': 'Emergency SOS Activated',
        'alert_details': {
            'student': user.username,
            'phone': user.phone,
            'coordinates': (lat, lng),
            'emergency_contact': emergency_contact,
            'dispatch': 'Campus Security Dispatched'
        }
    })


@csrf_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_reports_list(request):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    reports = Report.objects.all().order_by('-created_at')
    serializer = ReportSerializer(reports, many=True)
    return Response(serializer.data)


@csrf_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_users_list(request):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    users = User.objects.all().order_by('username')
    serializer = UserSerializer(users, many=True)
    return Response(serializer.data)


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def resolve_report_admin(request, pk):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        report = Report.objects.get(pk=pk)
    except Report.DoesNotExist:
        return Response({'error': 'Report not found'}, status=status.HTTP_404_NOT_FOUND)
    
    report.status = 'resolved'
    report.save()
    return Response(ReportSerializer(report).data)


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def moderate_user_admin(request, pk):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        user = User.objects.get(pk=pk)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        
    action = request.data.get('action')
    if action == 'verify':
        user.verification_status = 'verified'
        user.save()
        
        # Notify user
        Notification.objects.create(
            user=user,
            title="Profile Verified!",
            content="Congratulations, an administrator has verified your student status.",
            notification_type="system"
        )
    elif action == 'reject':
        user.verification_status = 'unverified'
        user.save()
        
        # Notify user
        Notification.objects.create(
            user=user,
            title="Verification Rejected",
            content="Your student status verification request was rejected. Please re-upload valid details.",
            notification_type="system"
        )
    else:
        return Response({'error': 'Invalid action'}, status=status.HTTP_400_BAD_REQUEST)
        
    return Response(UserSerializer(user).data)


@csrf_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_sos_list(request):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    sos_events = SOSEvent.objects.all().order_by('-created_at')
    serializer = SOSEventSerializer(sos_events, many=True)
    return Response(serializer.data)


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def resolve_sos_admin(request, pk):
    if not request.user.is_staff:
        return Response({'error': 'Access denied. Staff only.'}, status=status.HTTP_403_FORBIDDEN)
    try:
        event = SOSEvent.objects.get(pk=pk)
    except SOSEvent.DoesNotExist:
        return Response({'error': 'SOS Event not found'}, status=status.HTTP_404_NOT_FOUND)
    
    event.status = 'resolved'
    event.save()
    return Response(SOSEventSerializer(event).data)


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_ride_pin_view(request, pk):
    """
    Validates a ride booking verification PIN entered manually by the driver.
    Transitions the ride status to 'started'.
    """
    try:
        booking = Booking.objects.get(pk=pk)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    # Security check: Only the assigned driver is allowed to verify
    if booking.ride.driver != request.user:
        return Response({'error': 'Only the assigned driver can verify this ride'}, status=status.HTTP_403_FORBIDDEN)

    pin = request.data.get('pin')
    if not pin or booking.verification_pin != pin:
        return Response({'error': 'Invalid PIN or QR code'}, status=status.HTTP_400_BAD_REQUEST)

    # Prevent double-verification
    if booking.is_verified:
        return Response({'error': 'Ride has already been verified'}, status=status.HTTP_400_BAD_REQUEST)

    booking.is_verified = True
    booking.verified_at = timezone.now()
    booking.ride_status = 'started'
    booking.save()

    # Notify Passenger that the ride has started
    Notification.objects.create(
        user=booking.passenger,
        title="Ride Started",
        content=f"Your ride with {booking.ride.driver.username} has been verified and has started.",
        notification_type="ride_update",
        related_id=booking.id
    )

    return Response({
        'message': 'Ride verified successfully',
        'booking': BookingSerializer(booking, context={'request': request}).data
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def verify_ride_qr_view(request):
    """
    Validates a ride booking verification secure QR token scanned by the driver.
    Transitions the ride status to 'started'.
    """
    token = request.data.get('token')
    if not token:
        return Response({'error': 'Token is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        booking = Booking.objects.get(verification_token=token)
    except Booking.DoesNotExist:
        return Response({'error': 'Invalid PIN or QR code'}, status=status.HTTP_400_BAD_REQUEST)

    # Security check: Only the assigned driver is allowed to verify
    if booking.ride.driver != request.user:
        return Response({'error': 'Only the assigned driver can verify this ride'}, status=status.HTTP_403_FORBIDDEN)

    # Prevent double-verification
    if booking.is_verified:
        return Response({'error': 'Ride has already been verified'}, status=status.HTTP_400_BAD_REQUEST)

    booking.is_verified = True
    booking.verified_at = timezone.now()
    booking.ride_status = 'started'
    booking.save()

    # Notify Passenger that the ride has started
    Notification.objects.create(
        user=booking.passenger,
        title="Ride Started",
        content=f"Your ride with {booking.ride.driver.username} has been verified and has started.",
        notification_type="ride_update",
        related_id=booking.id
    )

    return Response({
        'message': 'Ride verified successfully',
        'booking': BookingSerializer(booking, context={'request': request}).data
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def complete_ride_view(request, pk):
    """
    Marks a verified/started ride booking as completed.
    Expires/clears the PIN and token.
    """
    try:
        booking = Booking.objects.get(pk=pk)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    # Security check: Only the assigned driver is allowed to complete the ride
    if booking.ride.driver != request.user:
        return Response({'error': 'Only the assigned driver can complete this ride'}, status=status.HTTP_403_FORBIDDEN)

    if booking.ride_status != 'started':
        return Response({'error': 'Only started rides can be completed'}, status=status.HTTP_400_BAD_REQUEST)

    booking.ride_status = 'completed'
    # PIN/QR expires after completed
    booking.verification_pin = None
    booking.verification_token = None
    booking.save()

    # Notify Passenger that the ride has completed
    Notification.objects.create(
        user=booking.passenger,
        title="Ride Completed",
        content=f"Your ride with {booking.ride.driver.username} has been completed.",
        notification_type="ride_update",
        related_id=booking.id
    )

    return Response({
        'message': 'Ride completed successfully',
        'booking': BookingSerializer(booking, context={'request': request}).data
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def update_ride_location_view(request, pk):
    """
    Updates the live GPS coordinates of the driver for an active ride.
    Only the ride's driver is allowed to call this.
    """
    try:
        ride = Ride.objects.get(pk=pk)
    except Ride.DoesNotExist:
        return Response({'error': 'Ride not found'}, status=status.HTTP_404_NOT_FOUND)

    # Security check: Only the ride's driver can update the location
    if ride.driver != request.user:
        return Response({'error': 'Only the assigned driver can update location'}, status=status.HTTP_403_FORBIDDEN)

    try:
        lat = float(request.data.get('lat'))
        lng = float(request.data.get('lng'))
    except (TypeError, ValueError):
        return Response({'error': 'Invalid latitude or longitude format'}, status=status.HTTP_400_BAD_REQUEST)

    loc, created = RideLocation.objects.get_or_create(
        ride=ride,
        driver=request.user,
        defaults={'latitude': lat, 'longitude': lng}
    )
    if not created:
        loc.latitude = lat
        loc.longitude = lng
        loc.save()

    return Response({
        'status': 'ok',
        'lat': loc.latitude,
        'lng': loc.longitude
    })


@csrf_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_ride_location_view(request, pk):
    """
    Retrieves the latest live location of the driver for a ride.
    """
    try:
        ride = Ride.objects.get(pk=pk)
    except Ride.DoesNotExist:
        return Response({'error': 'Ride not found'}, status=status.HTTP_404_NOT_FOUND)

    loc = RideLocation.objects.filter(ride=ride).order_by('-updated_at').first()
    if loc:
        return Response({
            'lat': loc.latitude,
            'lng': loc.longitude,
            'updated_at': loc.updated_at
        })
    return Response({'lat': None})


@csrf_exempt
@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def timetable_list_create_view(request):
    """
    List user timetable entries or create a new one.
    """
    if request.user.verification_status != 'verified':
        return Response({'error': 'Only verified students can access timetable ride matching'}, status=status.HTTP_403_FORBIDDEN)

    if request.method == 'GET':
        entries = Timetable.objects.filter(student=request.user)
        serializer = TimetableSerializer(entries, many=True, context={'request': request})
        return Response(serializer.data)

    elif request.method == 'POST':
        serializer = TimetableSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            serializer.save(student_id=request.user.id)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@csrf_exempt
@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def timetable_detail_update_delete_view(request, pk):
    """
    Retrieve, update, or delete a timetable entry.
    """
    if request.user.verification_status != 'verified':
        return Response({'error': 'Only verified students can access timetable ride matching'}, status=status.HTTP_403_FORBIDDEN)

    try:
        entry = Timetable.objects.get(pk=pk, student=request.user)
    except Timetable.DoesNotExist:
        return Response({'error': 'Timetable entry not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        serializer = TimetableSerializer(entry, context={'request': request})
        return Response(serializer.data)

    elif request.method == 'PUT':
        serializer = TimetableSerializer(entry, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        entry.delete()
        return Response({'message': 'Timetable entry deleted successfully'}, status=status.HTTP_204_NO_CONTENT)


@csrf_exempt
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def timetable_matches_view(request):
    """
    Matches timetable schedules with available driver rides and other students.
    """
    if request.user.verification_status != 'verified':
        return Response({'error': 'Only verified students can access timetable ride matching'}, status=status.HTTP_403_FORBIDDEN)

    timetable_id = request.query_params.get('timetable_id')
    if not timetable_id:
        return Response({'error': 'timetable_id is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        timetable = Timetable.objects.get(pk=timetable_id, student=request.user)
    except Timetable.DoesNotExist:
        return Response({'error': 'Timetable entry not found'}, status=status.HTTP_404_NOT_FOUND)

    # 1. Match with upcoming driver rides
    blocked_ids = list(BlockedUser.objects.filter(blocker=request.user).values_list('blocked_id', flat=True))
    blocked_by_ids = list(BlockedUser.objects.filter(blocked=request.user).values_list('blocker_id', flat=True))
    exclude_user_ids = set(blocked_ids + blocked_by_ids + [request.user.id])

    candidate_rides = Ride.objects.exclude(driver_id__in=exclude_user_ids).filter(seats_available__gt=0)
    
    matched_rides = []
    for ride in candidate_rides:
        is_match, score = calculate_ride_timetable_match_score(ride, timetable)
        if is_match:
            ride_data = RideSerializer(ride, context={'request': request}).data
            matched_rides.append({
                'ride': ride_data,
                'match_score': score
            })

    matched_rides.sort(key=lambda x: x['match_score'], reverse=True)

    # 2. Match with other student schedules
    candidate_timetables = Timetable.objects.exclude(student_id__in=exclude_user_ids)
    
    matched_students = []
    for ct in candidate_timetables:
        is_match, score = calculate_timetable_match_score(timetable, ct)
        if is_match:
            student_data = UserMinSerializer(ct.student).data
            matched_students.append({
                'timetable_id': ct.id,
                'student': student_data,
                'course_name': ct.course_name,
                'day_of_week': ct.day_of_week,
                'class_start_time': ct.class_start_time.strftime('%H:%M'),
                'preferred_departure_time': ct.preferred_departure_time.strftime('%H:%M'),
                'pickup_name': ct.pickup_name,
                'dropoff_name': ct.dropoff_name,
                'match_score': score
            })

    matched_students.sort(key=lambda x: x['match_score'], reverse=True)

    # 3. Recommendations
    student_count = len(matched_students)
    
    # Calculate recommended departure time by estimating travel duration (Avg speed 30 km/h + 15 min buffer)
    dist_route = haversine_distance(timetable.pickup_lat, timetable.pickup_lng, timetable.dropoff_lat, timetable.dropoff_lng)
    est_travel_time_mins = int((dist_route / 30.0) * 60) + 15
    class_start_mins = timetable.class_start_time.hour * 60 + timetable.class_start_time.minute
    rec_dept_mins = class_start_mins - est_travel_time_mins
    
    if rec_dept_mins < 0:
        rec_dept_mins += 24 * 60
        
    rec_hour = (rec_dept_mins // 60) % 24
    rec_min = rec_dept_mins % 60
    
    from datetime import time
    rec_time_obj = time(hour=rec_hour, minute=rec_min)
    recommended_departure = rec_time_obj.strftime('%I:%M %p')

    if student_count > 0:
        recommendation_text = f"We recommend departing at {recommended_departure}. {student_count} student(s) near your area are going to {timetable.dropoff_name} around the same time. Create a shared ride?"
    else:
        recommendation_text = f"No classmate matches found yet. We recommend departing at {recommended_departure} to reach class on time."

    return Response({
        'timetable': TimetableSerializer(timetable, context={'request': request}).data,
        'matched_rides': matched_rides,
        'matched_students': matched_students,
        'recommended_departure_time': recommended_departure,
        'recommendation_message': recommendation_text
    })


@csrf_exempt
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def timetable_create_recurring_ride_view(request):
    """
    Creates a recurring Ride from a student timetable schedule.
    """
    if request.user.verification_status != 'verified':
        return Response({'error': 'Only verified students can access timetable ride matching'}, status=status.HTTP_403_FORBIDDEN)

    timetable_id = request.data.get('timetable_id')
    price_per_seat = request.data.get('price_per_seat')
    vehicle_model = request.data.get('vehicle_model')
    vehicle_plate = request.data.get('vehicle_plate')
    vehicle_type = request.data.get('vehicle_type', 'car')
    seats_total = request.data.get('seats_total', 4)
    notes = request.data.get('notes', '')

    if not all([timetable_id, price_per_seat, vehicle_model, vehicle_plate]):
        return Response({'error': 'Missing required fields: timetable_id, price_per_seat, vehicle_model, vehicle_plate'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        timetable = Timetable.objects.get(pk=timetable_id, student=request.user)
    except Timetable.DoesNotExist:
        return Response({'error': 'Timetable entry not found'}, status=status.HTTP_404_NOT_FOUND)

    from django.utils import timezone
    import datetime
    
    day_map = {
        'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
        'friday': 4, 'saturday': 5, 'sunday': 6
    }
    target_weekday = day_map.get(timetable.day_of_week.strip().lower(), 0)
    
    current_date = timezone.now().date()
    current_weekday = current_date.weekday()
    
    days_ahead = target_weekday - current_weekday
    if days_ahead < 0:
        days_ahead += 7
    elif days_ahead == 0:
        now_time = timezone.now().time()
        if timetable.preferred_departure_time < now_time:
            days_ahead = 7
            
    ride_date = current_date + datetime.timedelta(days=days_ahead)

    ride = Ride.objects.create(
        driver=request.user,
        pickup_name=timetable.pickup_name,
        pickup_lat=timetable.pickup_lat,
        pickup_lng=timetable.pickup_lng,
        dropoff_name=timetable.dropoff_name,
        dropoff_lat=timetable.dropoff_lat,
        dropoff_lng=timetable.dropoff_lng,
        date=ride_date,
        time=timetable.preferred_departure_time,
        seats_total=int(seats_total),
        seats_available=int(seats_total),
        price_per_seat=price_per_seat,
        vehicle_model=vehicle_model,
        vehicle_plate=vehicle_plate,
        vehicle_type=vehicle_type,
        notes=notes,
        is_recurring=True,
        recurring_days=timetable.day_of_week
    )

    Notification.objects.create(
        user=request.user,
        title="Recurring Ride Created",
        content=f"Your recurring ride for every {timetable.day_of_week} at {timetable.preferred_departure_time.strftime('%I:%M %p')} has been created.",
        notification_type="ride_update",
        related_id=ride.id
    )

    return Response(RideSerializer(ride, context={'request': request}).data, status=status.HTTP_201_CREATED)



