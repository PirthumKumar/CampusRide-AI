import os
import django
from decimal import Decimal
from datetime import date, time, timedelta

# Initialize Django environment
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'campus_ride.settings')
django.setup()

from core.models import User, Ride, Booking, Message, Notification, Review, Report
from django.utils import timezone

def seed():
    print("[CLEAN] Cleaning database...")
    User.objects.all().delete()
    Ride.objects.all().delete()
    Booking.objects.all().delete()
    Message.objects.all().delete()
    Notification.objects.all().delete()
    Review.objects.all().delete()
    Report.objects.all().delete()

    print("[USER] Creating admin and test users...")
    # Admin Superuser
    admin = User.objects.create_superuser(
        username='admin',
        email='admin@university.edu',
        password='adminpass',
        phone='+1-555-0000',
        university='Campus Security Dispatch',
        gender='Other',
        emergency_contact='Campus Security Hotline (+1-555-9999)'
    )
    print("  - Admin user 'admin' created (password: adminpass)")

    # Alice the driver (Verified)
    alice = User.objects.create_user(
        username='alice',
        email='alice@state.edu',
        password='alicepass',
        phone='+1-555-0101',
        university='State University',
        gender='Female',
        verification_status='verified',
        verification_doc='State Univ Card #99281. Exp 2027.',
        emergency_contact='Parent: +1-555-9001',
        rating_avg=4.8
    )
    print("  - Driver user 'alice' created (password: alicepass)")

    # Bob the passenger (Verified)
    bob = User.objects.create_user(
        username='bob',
        email='bob@state.edu',
        password='bobpass',
        phone='+1-555-0102',
        university='State University',
        gender='Male',
        verification_status='verified',
        verification_doc='State Univ Card #12345. Exp 2028.',
        emergency_contact='Guardian: +1-555-9002',
        rating_avg=4.5
    )
    print("  - Passenger user 'bob' created (password: bobpass)")

    # Charlie the driver (Pending Verification)
    charlie = User.objects.create_user(
        username='charlie',
        email='charlie@state.edu',
        password='charliepass',
        phone='+1-555-0103',
        university='State University',
        gender='Male',
        verification_status='pending',
        verification_doc='State Univ ID card. Name: Charlie Smith. Photo: charlie_id.png',
        emergency_contact='Spouse: +1-555-9003',
        rating_avg=4.2
    )
    print("  - Pending driver 'charlie' created (password: charliepass)")

    # Diana the passenger (Unverified)
    diana = User.objects.create_user(
        username='diana',
        email='diana@city.edu',
        password='dianapass',
        phone='+1-555-0104',
        university='City College',
        gender='Female',
        verification_status='unverified',
        emergency_contact='Sibling: +1-555-9004',
        rating_avg=5.0
    )
    print("  - Unverified passenger 'diana' created (password: dianapass)")

    # External Driver (Verified)
    ext_driver_verified = User.objects.create_user(
        username='ext_driver_verified',
        email='ext_verified@driver.com',
        password='driverpass',
        phone='+1-555-0201',
        university='External',
        gender='Male',
        verification_status='verified',
        verification_doc='License #PK-9912. Verified Plate: A-991. Exp 2029.',
        emergency_contact='Spouse: +1-555-9011',
        rating_avg=4.9,
        role='external_driver'
    )
    print("  - Verified external driver 'ext_driver_verified' created (password: driverpass)")

    # External Driver (Unverified)
    ext_driver_unverified = User.objects.create_user(
        username='ext_driver_unverified',
        email='ext_unverified@driver.com',
        password='driverpass',
        phone='+1-555-0202',
        university='External',
        gender='Male',
        verification_status='unverified',
        emergency_contact='Friend: +1-555-9012',
        rating_avg=5.0,
        role='external_driver'
    )
    print("  - Unverified external driver 'ext_driver_unverified' created (password: driverpass)")

    print("[RIDE] Creating ride posts...")
    # Ride 1: Alice driving tomorrow morning
    tomorrow = date.today() + timedelta(days=1)
    ride1 = Ride.objects.create(
        driver=alice,
        pickup_name='NUST Campus H-12, Islamabad',
        pickup_lat=33.6428,
        pickup_lng=72.9904,
        dropoff_name='Faisal Mosque, Islamabad',
        dropoff_lat=33.7297,
        dropoff_lng=73.0372,
        date=tomorrow,
        time=time(8, 30),
        seats_total=4,
        seats_available=4,  # Will adjust when booking is approved
        price_per_seat=Decimal('150.00'),
        vehicle_model='Tesla Model 3 (Midnight Blue)',
        vehicle_plate='E-DRIVE1',
        notes='Eco-friendly ride. Clean trunk for bags. Commute from campus to Faisal Mosque area.',
        is_recurring=False
    )
    print("  - Ride 1 created (Alice: NUST -> Faisal Mosque)")

    # Ride 4: External verified driver
    ride4 = Ride.objects.create(
        driver=ext_driver_verified,
        pickup_name='Giga Mall, Rawalpindi',
        pickup_lat=33.5201,
        pickup_lng=73.1610,
        dropoff_name='Centaurus Mall, Islamabad',
        dropoff_lat=33.7077,
        dropoff_lng=73.0498,
        date=tomorrow,
        time=time(10, 0),
        seats_total=4,
        seats_available=4,
        price_per_seat=Decimal('300.00'),
        vehicle_model='Toyota Corolla (White)',
        vehicle_plate='A-991',
        notes='External driver carpool. Direct highway route. AC active.',
        is_recurring=False
    )
    print("  - Ride 4 created (Verified External Driver: Giga Mall -> Centaurus)")

    # Ride 2: Charlie driving tomorrow afternoon
    ride2 = Ride.objects.create(
        driver=charlie,
        pickup_name='Giga Mall, Rawalpindi',
        pickup_lat=33.5201,
        pickup_lng=73.1610,
        dropoff_name='NUST Campus H-12, Islamabad',
        dropoff_lat=33.6428,
        dropoff_lng=72.9904,
        date=tomorrow,
        time=time(14, 0),
        seats_total=3,
        seats_available=3,
        price_per_seat=Decimal('250.00'),
        vehicle_model='Honda Civic (Silver)',
        vehicle_plate='CIVIC-99',
        notes='Stopping by Kashmir Highway first. No smoking please.',
        is_recurring=False
    )
    print("  - Ride 2 created (Charlie: Giga Mall -> NUST)")

    # Ride 3: Alice recurring route
    ride3 = Ride.objects.create(
        driver=alice,
        pickup_name='Centaurus Mall, Islamabad',
        pickup_lat=33.7077,
        pickup_lng=73.0498,
        dropoff_name='NUST Campus H-12, Islamabad',
        dropoff_lat=33.6428,
        dropoff_lng=72.9904,
        date=date.today(),
        time=time(17, 30),
        seats_total=4,
        seats_available=4,
        price_per_seat=Decimal('100.00'),
        vehicle_model='Tesla Model 3 (Midnight Blue)',
        vehicle_plate='E-DRIVE1',
        notes='Weekly commute for Lab Seminar.',
        is_recurring=True,
        recurring_days='Mon,Wed,Fri'
    )
    print("  - Ride 3 created (Alice recurring: Centaurus -> NUST)")

    print("[BOOKING] Creating bookings and requests...")
    # Bob has an approved booking on Alice's Ride 1
    booking1 = Booking.objects.create(
        ride=ride1,
        passenger=bob,
        seats_booked=1,
        status='approved'
    )
    ride1.seats_available -= 1
    ride1.save()
    print("  - Bob's booking on Ride 1: APPROVED")

    # Diana has a pending request on Alice's Ride 1
    booking2 = Booking.objects.create(
        ride=ride1,
        passenger=diana,
        seats_booked=1,
        status='pending'
    )
    print("  - Diana's booking request on Ride 1: PENDING")

    print("[CHAT] Creating conversations & chat history...")
    # Messaging between Alice and Bob about Ride 1
    Message.objects.create(
        sender=bob,
        receiver=alice,
        ride=ride1,
        content="Hi Alice, is there enough trunk space for a medium backpack?",
        is_read=True
    )
    Message.objects.create(
        sender=alice,
        receiver=bob,
        ride=ride1,
        content="Yes, Bob! My Model 3 has front and rear trunks, plenty of room.",
        is_read=True
    )
    Message.objects.create(
        sender=bob,
        receiver=alice,
        ride=ride1,
        content="Perfect! Looking forward to the commute.",
        is_read=False
    )
    print("  - Chat messages created between Alice and Bob")

    print("[REVIEW] Creating reviews...")
    # Review from Bob to Alice
    Review.objects.create(
        ride=ride1,
        reviewer=bob,
        reviewee=alice,
        rating=5,
        comment="Alice is super professional, drives safely, and the EV is super quiet!"
    )
    alice.update_rating_average()
    print("  - Bob's 5-star review for Alice created")

    print("[REPORT] Creating moderation reports...")
    # Report from Bob against Charlie (Simulating a safety complain)
    report = Report.objects.create(
        reporter=bob,
        reported_user=charlie,
        ride=ride2,
        reason='inappropriate_behavior',
        details='Charlie was texting while driving and playing inappropriate music during a previous trip.',
        status='pending'
    )
    print("  - Safety report filed by Bob against Charlie")

    print("[NOTIF] Creating notifications...")
    # Notification to Alice about Diana's pending request
    Notification.objects.create(
        user=alice,
        title="New Booking Request",
        content="diana requested 1 seat(s) for your ride from NUST Campus H-12, Islamabad.",
        notification_type="booking_request",
        related_id=booking2.id
    )

    # Notification to Bob about booking approval
    Notification.objects.create(
        user=bob,
        title="Booking Approved!",
        content="Your booking request for ride to Faisal Mosque, Islamabad was approved by alice.",
        notification_type="booking_status",
        related_id=booking1.id
    )

    # Notifications to Admins about Charlie's verification and report
    Notification.objects.create(
        user=admin,
        title="Pending Verification Request",
        content="Student charlie has submitted a new verification request.",
        notification_type="system",
        related_id=charlie.id
    )
    Notification.objects.create(
        user=admin,
        title="New User Report Filed",
        content="bob reported charlie for: inappropriate_behavior.",
        notification_type="system",
        related_id=report.id
    )
    print("  - System alerts and user notifications seeded")

    print("[SUCCESS] Database seeding complete!")

if __name__ == '__main__':
    seed()
