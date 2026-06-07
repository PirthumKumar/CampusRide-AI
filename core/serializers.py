from rest_framework import serializers
from .models import User, Ride, Booking, Message, Notification, Review, Report, BlockedUser, SOSEvent, Timetable


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

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            # Hide exact pickup address if:
            # 1. User is NOT the driver
            # 2. User has NO approved booking on this ride
            is_driver = (instance.driver.id == request.user.id)
            is_approved_passenger = instance.bookings.filter(
                passenger=request.user, status='approved'
            ).exists()
            
            if not is_driver and not is_approved_passenger:
                ret['pickup_address_details'] = 'Hidden until ride accepted'
        return ret


class BookingSerializer(serializers.ModelSerializer):
    passenger = UserMinSerializer(read_only=True)
    ride = RideSerializer(read_only=True)
    ride_id = serializers.IntegerField(write_only=True)

    class Meta:
        model = Booking
        fields = ('id', 'ride', 'ride_id', 'passenger', 'seats_booked', 'status', 'created_at',
                  'verification_pin', 'verification_token', 'is_verified', 'verified_at', 'ride_status')
        read_only_fields = ('created_at',)

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            is_passenger = (instance.passenger.id == request.user.id)
            is_driver = (instance.ride.driver.id == request.user.id)
            
            if not is_passenger:
                ret.pop('verification_pin', None)
            if not is_passenger and not is_driver:
                ret.pop('verification_token', None)
        else:
            ret.pop('verification_pin', None)
            ret.pop('verification_token', None)
        return ret

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


class TimetableSerializer(serializers.ModelSerializer):
    student = UserMinSerializer(read_only=True)
    student_id = serializers.IntegerField(write_only=True, required=False)

    class Meta:
        model = Timetable
        fields = ('id', 'student', 'student_id', 'course_name', 'day_of_week', 
                  'class_start_time', 'class_end_time', 'dropoff_name', 'dropoff_lat', 
                  'dropoff_lng', 'pickup_name', 'pickup_lat', 'pickup_lng', 
                  'preferred_departure_time', 'created_at')
        read_only_fields = ('created_at',)

    def create(self, validated_data):
        student_id = validated_data.pop('student_id', None)
        if student_id:
            student = User.objects.get(id=student_id)
            return Timetable.objects.create(student=student, **validated_data)
        return super().create(validated_data)

