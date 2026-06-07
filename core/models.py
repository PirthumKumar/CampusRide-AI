from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator, MaxValueValidator

class User(AbstractUser):
    phone = models.CharField(max_length=20, blank=True, null=True)
    university = models.CharField(max_length=100, blank=True, null=True)
    gender = models.CharField(max_length=20, blank=True, null=True)
    avatar_url = models.CharField(max_length=500, blank=True, null=True, default='/static/images/default-avatar.png')
    
    STATUS_CHOICES = [
        ('unverified', 'Unverified'),
        ('pending', 'Pending Verification'),
        ('verified', 'Verified'),
    ]
    verification_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unverified')
    verification_doc = models.TextField(blank=True, null=True)  # Stores brief description or mock image data
    emergency_contact = models.CharField(max_length=100, blank=True, null=True)
    ROLE_CHOICES = [
        ('student', 'Student'),
        ('external_driver', 'External Driver'),
        ('admin', 'Admin'),
    ]
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='student')
    rating_avg = models.FloatField(default=5.0)

    def update_rating_average(self):
        ratings = self.reviews_received.all()
        if ratings.exists():
            total = sum(r.rating for r in ratings)
            self.rating_avg = round(total / ratings.count(), 2)
        else:
            self.rating_avg = 5.0
        self.save(update_fields=['rating_avg'])

    def __str__(self):
        return f"{self.username} ({self.university or 'No Uni'})"


class Ride(models.Model):
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='driver_rides')
    pickup_name = models.CharField(max_length=200)
    pickup_address_details = models.CharField(max_length=300, blank=True, null=True)
    pickup_lat = models.FloatField()
    pickup_lng = models.FloatField()
    dropoff_name = models.CharField(max_length=200)
    dropoff_address_details = models.CharField(max_length=300, blank=True, null=True)
    dropoff_lat = models.FloatField()
    dropoff_lng = models.FloatField()
    date = models.DateField()
    time = models.TimeField()
    seats_total = models.IntegerField(default=4)
    seats_available = models.IntegerField(default=4)
    price_per_seat = models.DecimalField(max_digits=6, decimal_places=2)
    vehicle_model = models.CharField(max_length=100)
    vehicle_plate = models.CharField(max_length=20)
    vehicle_type = models.CharField(max_length=20, default='car')  # 'car' or 'motorbike'
    notes = models.TextField(blank=True, null=True)
    is_recurring = models.BooleanField(default=False)
    recurring_days = models.CharField(max_length=100, blank=True, null=True)  # e.g., "Mon,Wed,Fri"
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Ride from {self.pickup_name} to {self.dropoff_name} by {self.driver.username}"


class Booking(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
        ('cancelled', 'Cancelled'),
    ]
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name='bookings')
    passenger = models.ForeignKey(User, on_delete=models.CASCADE, related_name='bookings')
    seats_booked = models.IntegerField(default=1)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    # Verification Fields
    verification_pin = models.CharField(max_length=6, blank=True, null=True)
    verification_token = models.CharField(max_length=100, blank=True, null=True, unique=True)
    is_verified = models.BooleanField(default=False)
    verified_at = models.DateTimeField(blank=True, null=True)
    
    RIDE_STATUS_CHOICES = [
        ('pending', 'Pending Approval'),
        ('confirmed', 'Confirmed'),
        ('started', 'Started'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    ride_status = models.CharField(max_length=20, choices=RIDE_STATUS_CHOICES, default='pending')

    def __str__(self):
        return f"Booking of {self.seats_booked} seat(s) on Ride {self.ride.id} by {self.passenger.username} ({self.status})"


class Message(models.Model):
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    receiver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='received_messages')
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name='chat_messages', null=True, blank=True)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    def __str__(self):
        return f"From {self.sender.username} to {self.receiver.username} regarding Ride {self.ride.id if self.ride else 'General'}"


class Notification(models.Model):
    TYPE_CHOICES = [
        ('booking_request', 'Booking Request'),
        ('booking_status', 'Booking Status Update'),
        ('new_message', 'New Message'),
        ('ride_update', 'Ride Update'),
        ('system', 'System Alert'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='notifications')
    title = models.CharField(max_length=200)
    content = models.TextField()
    notification_type = models.CharField(max_length=50, choices=TYPE_CHOICES)
    related_id = models.IntegerField(null=True, blank=True)  # e.g., booking_id, ride_id, or message_id
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Notification for {self.user.username}: {self.title}"


class Review(models.Model):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name='reviews')
    reviewer = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reviews_written')
    reviewee = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reviews_received')
    rating = models.IntegerField(validators=[MinValueValidator(1), MaxValueValidator(5)])
    comment = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Review by {self.reviewer.username} for {self.reviewee.username} ({self.rating} Stars)"


class Report(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('resolved', 'Resolved'),
    ]
    reporter = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reports_submitted')
    reported_user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='reports_received')
    ride = models.ForeignKey(Ride, on_delete=models.SET_NULL, null=True, blank=True, related_name='reports')
    reason = models.CharField(max_length=200)
    details = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report by {self.reporter.username} against {self.reported_user.username} - {self.status}"


class BlockedUser(models.Model):
    blocker = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_users')
    blocked = models.ForeignKey(User, on_delete=models.CASCADE, related_name='blocked_by_users')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('blocker', 'blocked')

    def __str__(self):
        return f"{self.blocker.username} blocked {self.blocked.username}"


class SOSEvent(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('resolved', 'Resolved'),
    ]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sos_events')
    ride = models.ForeignKey(Ride, on_delete=models.SET_NULL, null=True, blank=True, related_name='sos_events')
    latitude = models.FloatField()
    longitude = models.FloatField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"SOS by {self.user.username} - {self.status} ({self.created_at})"


class RideLocation(models.Model):
    ride = models.ForeignKey(Ride, on_delete=models.CASCADE, related_name='locations')
    driver = models.ForeignKey(User, on_delete=models.CASCADE)
    latitude = models.FloatField()
    longitude = models.FloatField()
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('ride', 'driver')

    def __str__(self):
        return f"Location of Ride {self.ride.id} by Driver {self.driver.username} ({self.latitude}, {self.longitude})"


class Timetable(models.Model):
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='timetable_entries')
    course_name = models.CharField(max_length=200)
    day_of_week = models.CharField(max_length=20)  # e.g., "Monday", "Tuesday", etc.
    class_start_time = models.TimeField()
    class_end_time = models.TimeField()
    dropoff_name = models.CharField(max_length=200)  # Campus building or destination
    dropoff_lat = models.FloatField()
    dropoff_lng = models.FloatField()
    pickup_name = models.CharField(max_length=200)  # Pickup location
    pickup_lat = models.FloatField()
    pickup_lng = models.FloatField()
    preferred_departure_time = models.TimeField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.course_name} ({self.day_of_week}) for {self.student.username}"


class RideAnalytics(models.Model):
    ride_id = models.IntegerField(null=True, blank=True)
    route = models.CharField(max_length=500)
    pickup_location = models.CharField(max_length=200)
    dropoff_location = models.CharField(max_length=200)
    departure_time = models.DateTimeField()
    completed_at = models.DateTimeField(auto_now_add=True)
    distance = models.FloatField(default=0.0)
    duration = models.FloatField(default=0.0)
    shared_seats = models.IntegerField(default=0)
    estimated_co2_saved = models.FloatField(default=0.0)
    estimated_money_saved = models.FloatField(default=0.0)

    def __str__(self):
        return f"Analytics for Route: {self.route} (Saved: {self.estimated_co2_saved}kg CO2)"


class SafetyScore(models.Model):
    ride = models.ForeignKey(Ride, on_delete=models.SET_NULL, null=True, blank=True)
    driver = models.ForeignKey(User, on_delete=models.CASCADE, related_name='driver_safety_scores', null=True, blank=True)
    passenger = models.ForeignKey(User, on_delete=models.CASCADE, related_name='passenger_safety_scores', null=True, blank=True)
    score = models.IntegerField(default=100)
    label = models.CharField(max_length=50)
    reasons = models.TextField(blank=True, null=True)
    calculated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Safety Score: {self.score} ({self.label})"


class DemandPrediction(models.Model):
    route = models.CharField(max_length=500)
    day_of_week = models.CharField(max_length=20)
    time_slot = models.CharField(max_length=50)
    demand_level = models.CharField(max_length=20)
    predicted_rides = models.FloatField(default=0.0)
    confidence = models.FloatField(default=0.0)
    generated_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Prediction for {self.route} on {self.day_of_week}: {self.demand_level}"


class CopilotInsight(models.Model):
    user_type = models.CharField(max_length=20) # 'student' or 'admin'
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    title = models.CharField(max_length=200)
    message = models.TextField()
    insight_type = models.CharField(max_length=50) # 'demand', 'safety', 'sustainability', 'savings', 'general'
    priority = models.CharField(max_length=20, default='medium')
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    def __str__(self):
        return f"[{self.user_type.upper()}] {self.title}"


