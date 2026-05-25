from rest_framework import serializers
from .models import User, Ride, Booking, Message, Notification, Review, Report, BlockedUser, SOSEvent

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'phone', 'university', 'gender', 'avatar_url', 
                  'verification_status', 'verification_doc', 'emergency_contact', 'rating_avg', 'is_staff', 'role')
        read_only_fields = ('rating_avg', 'is_staff')

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ('username', 'email', 'password', 'phone', 'university', 'gender', 'emergency_contact', 'role')

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            phone=validated_data.get('phone', ''),
            university=validated_data.get('university', ''),
            gender=validated_data.get('gender', ''),
            emergency_contact=validated_data.get('emergency_contact', ''),
            role=validated_data.get('role', 'student'),
            verification_status='unverified'
        )
        return user

class UserMinSerializer(serializers.ModelSerializer):
    """Minimal serializer for nesting driver/passenger summaries in other feeds"""
    class Meta:
        model = User
        fields = ('id', 'username', 'university', 'avatar_url', 'verification_status', 'rating_avg', 'role')

class RideSerializer(serializers.ModelSerializer):
    driver = UserMinSerializer(read_only=True)
    driver_id = serializers.IntegerField(write_only=True, required=False)

    class Meta:
        model = Ride
        fields = ('id', 'driver', 'driver_id', 'pickup_name', 'pickup_address_details', 
                  'pickup_lat', 'pickup_lng', 'dropoff_name', 'dropoff_address_details', 
                  'dropoff_lat', 'dropoff_lng', 'date', 'time', 'seats_total', 
                  'seats_available', 'price_per_seat', 'vehicle_model', 'vehicle_plate', 
                  'vehicle_type', 'notes', 'is_recurring', 'recurring_days', 'created_at')
        read_only_fields = ('created_at',)

    def create(self, validated_data):
        driver_id = validated_data.pop('driver_id', None)
        if driver_id:
            driver = User.objects.get(id=driver_id)
            return Ride.objects.create(driver=driver, **validated_data)
        return super().create(validated_data)

class BookingSerializer(serializers.ModelSerializer):
    passenger = UserMinSerializer(read_only=True)
    ride = RideSerializer(read_only=True)
    ride_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = Booking
        fields = ('id', 'ride', 'ride_id', 'passenger', 'seats_booked', 'status', 'created_at')
        read_only_fields = ('created_at',)

class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.CharField(source='sender.username', read_only=True)
    receiver_name = serializers.CharField(source='receiver.username', read_only=True)

    class Meta:
        model = Message
        fields = ('id', 'sender', 'sender_name', 'receiver', 'receiver_name', 'ride', 'content', 'created_at', 'is_read')
        read_only_fields = ('created_at',)

class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = '__all__'

class ReviewSerializer(serializers.ModelSerializer):
    reviewer_name = serializers.CharField(source='reviewer.username', read_only=True)
    reviewee_name = serializers.CharField(source='reviewee.username', read_only=True)

    class Meta:
        model = Review
        fields = ('id', 'ride', 'reviewer', 'reviewer_name', 'reviewee', 'reviewee_name', 'rating', 'comment', 'created_at')

class ReportSerializer(serializers.ModelSerializer):
    reporter_name = serializers.CharField(source='reporter.username', read_only=True)
    reported_user_name = serializers.CharField(source='reported_user.username', read_only=True)

    class Meta:
        model = Report
        fields = ('id', 'reporter', 'reporter_name', 'reported_user', 'reported_user_name', 'ride', 'reason', 'details', 'status', 'created_at')


class SOSEventSerializer(serializers.ModelSerializer):
    user_details = UserSerializer(source='user', read_only=True)
    ride_details = RideSerializer(source='ride', read_only=True)

    class Meta:
        model = SOSEvent
        fields = ('id', 'user', 'user_details', 'ride', 'ride_details', 'latitude', 'longitude', 'status', 'created_at')
