from django.test import TestCase
from datetime import date, time
from .pricing import haversine_distance, is_rush_hour, get_price_prediction
from .matching import check_route_match, optimize_driver_route

class PricingTests(TestCase):
    def test_haversine_distance(self):
        # NYC Coordinates (Times Square to Empire State Building is ~1.5km)
        ts_lat, ts_lng = 40.7580, -73.9855
        es_lat, es_lng = 40.7484, -73.9857
        dist = haversine_distance(ts_lat, ts_lng, es_lat, es_lng)
        self.assertTrue(0.8 < dist < 2.0)
        
        # Zero distance
        self.assertEqual(haversine_distance(ts_lat, ts_lng, ts_lat, ts_lng), 0.0)

    def test_is_rush_hour(self):
        # Weekday morning rush
        self.assertTrue(is_rush_hour("08:30", "2026-05-20")) # May 20, 2026 is Wednesday
        # Weekday evening rush
        self.assertTrue(is_rush_hour("17:45", "2026-05-20"))
        # Weekday off-peak
        self.assertFalse(is_rush_hour("12:00", "2026-05-20"))
        # Weekend (rush hour shouldn't trigger on weekends)
        self.assertFalse(is_rush_hour("08:30", "2026-05-24")) # May 24, 2026 is Sunday

    def test_get_price_prediction(self):
        # 10 km route on weekday off-peak, Sedan, 4 seats total
        pred = get_price_prediction(
            pickup_lat=40.7128, pickup_lng=-74.0060,
            dropoff_lat=40.7829, dropoff_lng=-73.9654,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Toyota Camry Sedan", seats_total=4
        )
        self.assertTrue(pred['recommended_price'] > 0)
        self.assertEqual(pred['vehicle_multiplier'], 1.0)
        self.assertEqual(pred['traffic_multiplier'], 1.0)
        
        # Test SUV pricing premium
        pred_suv = get_price_prediction(
            pickup_lat=40.7128, pickup_lng=-74.0060,
            dropoff_lat=40.7829, dropoff_lng=-73.9654,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Toyota RAV4 SUV", seats_total=4
        )
        self.assertTrue(pred_suv['recommended_price'] > pred['recommended_price'])
        
        # Test Eco vehicle pricing discount
        pred_eco = get_price_prediction(
            pickup_lat=40.7128, pickup_lng=-74.0060,
            dropoff_lat=40.7829, dropoff_lng=-73.9654,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Tesla Model Y Electric", seats_total=4
        )
        self.assertTrue(pred_eco['recommended_price'] < pred['recommended_price'])

    def test_get_price_prediction_with_override(self):
        # Coordinates representing Times Square to Empire State Building (~1.5km haversine)
        # But we override it with a much larger road distance, say 25.0 km
        ts_lat, ts_lng = 40.7580, -73.9855
        es_lat, es_lng = 40.7484, -73.9857
        
        pred_normal = get_price_prediction(
            pickup_lat=ts_lat, pickup_lng=ts_lng,
            dropoff_lat=es_lat, dropoff_lng=es_lng,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Toyota Camry Sedan", seats_total=4
        )
        
        pred_override = get_price_prediction(
            pickup_lat=ts_lat, pickup_lng=ts_lng,
            dropoff_lat=es_lat, dropoff_lng=es_lng,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Toyota Camry Sedan", seats_total=4,
            override_distance_km=25.0
        )
        
        # Distance should match the override
        self.assertEqual(pred_override['distance_km'], 25.0)
        # Price with override (25km) should be significantly higher than standard (~1.5km)
        self.assertTrue(pred_override['recommended_price'] > pred_normal['recommended_price'])

    def test_motorbike_pricing(self):
        # 10 km route on weekday off-peak, Motorbike
        pred = get_price_prediction(
            pickup_lat=40.7128, pickup_lng=-74.0060,
            dropoff_lat=40.7829, dropoff_lng=-73.9654,
            ride_time_str="12:00", ride_date_str="2026-05-20",
            vehicle_model="Honda CG 125 Motorbike", seats_total=1,
            vehicle_type='motorbike'
        )
        self.assertTrue(pred['recommended_price'] > 50)
        self.assertEqual(pred['seat_factor'], 1.0)
        self.assertEqual(pred['vehicle_multiplier'], 1.0)



class MatchingTests(TestCase):
    def test_check_route_match(self):
        # Driver route: straight line from (0.0, 0.0) to (10.0, 0.0) (approx 1111 km)
        # Passenger route: pickup at (2.0, 0.001), dropoff at (8.0, 0.001)
        # This is along the route and in correct direction/order.
        res = check_route_match(
            p_pickup=(2.0, 0.001), p_dropoff=(8.0, 0.001),
            d_pickup=(0.0, 0.0), d_dropoff=(10.0, 0.0),
            max_dist_km=5.0
        )
        self.assertTrue(res['is_match'])
        
        # Wrong order: pickup after dropoff along driver path
        # Passenger pickup at (8.0, 0.001), dropoff at (2.0, 0.001)
        res_wrong_order = check_route_match(
            p_pickup=(8.0, 0.001), p_dropoff=(2.0, 0.001),
            d_pickup=(0.0, 0.0), d_dropoff=(10.0, 0.0),
            max_dist_km=5.0
        )
        self.assertFalse(res_wrong_order['is_match'])
        
        # Too far off route
        res_too_far = check_route_match(
            p_pickup=(2.0, 5.0), p_dropoff=(8.0, 5.0),
            d_pickup=(0.0, 0.0), d_dropoff=(10.0, 0.0),
            max_dist_km=2.0
        )
        self.assertFalse(res_too_far['is_match'])

    def test_optimize_driver_route(self):
        # Driver starts at (40.7128, -74.0060) and ends at (40.7589, -73.9851)
        # Passenger Alice pickup: (40.7200, -74.0000), dropoff: (40.7500, -73.9900)
        # Passenger Bob pickup: (40.7300, -73.9950), dropoff: (40.7400, -73.9920)
        driver_start = (40.7128, -74.0060)
        driver_end = (40.7589, -73.9851)
        
        bookings = [
            {
                'id': 1,
                'passenger_name': 'Alice',
                'pickup': (40.7200, -74.0000),
                'dropoff': (40.7500, -73.9900)
            },
            {
                'id': 2,
                'passenger_name': 'Bob',
                'pickup': (40.7300, -73.9950),
                'dropoff': (40.7400, -73.9920)
            }
        ]
        
        route, total_dist = optimize_driver_route(driver_start, driver_end, bookings)
        
        # Verify route sequence starts with Driver Start and ends with Driver End
        self.assertEqual(route[0]['type'], 'start')
        self.assertEqual(route[-1]['type'], 'end')
        
        # Verify that for each passenger, pickup comes before dropoff
        visited_types = {}
        for idx, stop in enumerate(route):
            if stop['type'] in ['pickup', 'dropoff']:
                b_id = stop['id']
                t = stop['type']
                if b_id not in visited_types:
                    visited_types[b_id] = []
                visited_types[b_id].append((t, idx))
                
        for b_id, stops in visited_types.items():
            self.assertEqual(len(stops), 2)
            # Find pickup and dropoff
            p_idx = [idx for t, idx in stops if t == 'pickup'][0]
            d_idx = [idx for t, idx in stops if t == 'dropoff'][0]
            self.assertTrue(p_idx < d_idx)


from rest_framework.test import APIClient
from rest_framework import status
from django.contrib.auth import get_user_model
from .models import User, Ride, Booking

class RBACTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.User = get_user_model()
        
        # Create users
        self.admin = self.User.objects.create_superuser(username="admin_user", email="admin@test.com", password="password123")
        self.student = self.User.objects.create_user(username="student_user", email="student@test.com", password="password123", role="student")
        self.driver_unverified = self.User.objects.create_user(username="driver_unverified", email="unverified@test.com", password="password123", role="external_driver", verification_status="unverified")
        self.driver_verified = self.User.objects.create_user(username="driver_verified", email="verified@test.com", password="password123", role="external_driver", verification_status="verified")
        
        # Create some rides
        self.ride_student = Ride.objects.create(
            driver=self.student,
            pickup_name="Student pickup", pickup_lat=33.6428, pickup_lng=72.9904,
            dropoff_name="Student dropoff", dropoff_lat=33.6500, dropoff_lng=73.0000,
            date="2026-06-01", time="08:00:00", price_per_seat=100.0, vehicle_model="Civic", vehicle_plate="123"
        )
        self.ride_verified_driver = Ride.objects.create(
            driver=self.driver_verified,
            pickup_name="Verified pickup", pickup_lat=33.6428, pickup_lng=72.9904,
            dropoff_name="Verified dropoff", dropoff_lat=33.6500, dropoff_lng=73.0000,
            date="2026-06-01", time="09:00:00", price_per_seat=120.0, vehicle_model="Corolla", vehicle_plate="456"
        )
        self.ride_unverified_driver = Ride.objects.create(
            driver=self.driver_unverified,
            pickup_name="Unverified pickup", pickup_lat=33.6428, pickup_lng=72.9904,
            dropoff_name="Unverified dropoff", dropoff_lat=33.6500, dropoff_lng=73.0000,
            date="2026-06-01", time="10:00:00", price_per_seat=150.0, vehicle_model="Mehran", vehicle_plate="789"
        )

    def test_registration_with_role(self):
        payload = {
            "username": "new_driver",
            "email": "new_driver@test.com",
            "password": "password123",
            "phone": "03001234567",
            "university": "NUST",
            "gender": "Male",
            "emergency_contact": "Guardian - 03007654321",
            "role": "external_driver"
        }
        response = self.client.post("/api/register/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["role"], "external_driver")
        self.assertEqual(response.data["verification_status"], "unverified")

    def test_unverified_external_driver_cannot_create_ride(self):
        self.client.force_authenticate(user=self.driver_unverified)
        payload = {
            "pickup_name": "NUST", "pickup_lat": 33.6428, "pickup_lng": 72.9904,
            "dropoff_name": "Faisal Mosque", "dropoff_lat": 33.7297, "dropoff_lng": 73.0372,
            "date": "2026-06-01", "time": "08:00:00", "seats_total": 4, "price_per_seat": 150.0,
            "vehicle_model": "Suzuki WagonR", "vehicle_plate": "LED-1234"
        }
        response = self.client.post("/api/rides/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_verified_external_driver_can_create_ride(self):
        self.client.force_authenticate(user=self.driver_verified)
        payload = {
            "pickup_name": "NUST", "pickup_lat": 33.6428, "pickup_lng": 72.9904,
            "dropoff_name": "Faisal Mosque", "dropoff_lat": 33.7297, "dropoff_lng": 73.0372,
            "date": "2026-06-01", "time": "08:00:00", "seats_total": 4, "price_per_seat": 150.0,
            "vehicle_model": "Suzuki WagonR", "vehicle_plate": "LED-1234"
        }
        response = self.client.post("/api/rides/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_external_driver_cannot_book_ride(self):
        self.client.force_authenticate(user=self.driver_verified)
        payload = {"ride_id": self.ride_student.id, "seats_booked": 1}
        response = self.client.post("/api/bookings/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_external_driver_cannot_match_ride(self):
        self.client.force_authenticate(user=self.driver_verified)
        response = self.client.get("/api/rides/matching/?pickup_lat=33.6428&pickup_lng=72.9904&dropoff_lat=33.7297&dropoff_lng=73.0372")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_external_driver_sees_only_own_rides(self):
        self.client.force_authenticate(user=self.driver_verified)
        response = self.client.get("/api/rides/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should only see their own ride (ride_verified_driver)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], self.ride_verified_driver.id)

    def test_student_sees_only_verified_drivers_rides(self):
        self.client.force_authenticate(user=self.student)
        response = self.client.get("/api/rides/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should see their own ride and the verified driver's ride, but NOT the unverified driver's ride
        ride_ids = [ride["id"] for ride in response.data]
        self.assertIn(self.ride_student.id, ride_ids)
        self.assertIn(self.ride_verified_driver.id, ride_ids)
        self.assertNotIn(self.ride_unverified_driver.id, ride_ids)

    def test_chat_functionality(self):
        self.client.force_authenticate(user=self.student)
        # Send message to the verified driver
        payload = {
            "receiver_id": self.driver_verified.id,
            "content": "Hi there, is the ride still active?",
            "ride_id": self.ride_verified_driver.id
        }
        response = self.client.post("/api/chat/messages/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["content"], "Hi there, is the ride still active?")
        
        # Verify message is in conversation history
        response_history = self.client.get(f"/api/chat/messages/?user_id={self.driver_verified.id}")
        self.assertEqual(response_history.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response_history.data), 1)
        self.assertEqual(response_history.data[0]["content"], "Hi there, is the ride still active?")

    def test_create_motorbike_ride_with_address_details(self):
        self.client.force_authenticate(user=self.driver_verified)
        payload = {
            "pickup_name": "NUST Campus Gate 1",
            "pickup_address_details": "Near KFC kiosk",
            "pickup_lat": 33.6428, "pickup_lng": 72.9904,
            "dropoff_name": "Faisal Mosque Parking",
            "dropoff_address_details": "Beside administrative block",
            "dropoff_lat": 33.7297, "dropoff_lng": 73.0372,
            "date": "2026-06-01", "time": "08:00:00", "seats_total": 1, "price_per_seat": 100.0,
            "vehicle_model": "Honda CD 70", "vehicle_plate": "LED-1234", "vehicle_type": "motorbike"
        }
        response = self.client.post("/api/rides/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["vehicle_type"], "motorbike")
        self.assertEqual(response.data["pickup_address_details"], "Near KFC kiosk")
        self.assertEqual(response.data["dropoff_address_details"], "Beside administrative block")


from .models import SOSEvent

class SOSEmergencyTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.User = get_user_model()
        self.admin = self.User.objects.create_superuser(username="admin_sos", email="admin_sos@test.com", password="password123")
        self.student = self.User.objects.create_user(username="student_sos", email="student_sos@test.com", password="password123", role="student")
        
    def test_trigger_sos_creates_db_event(self):
        self.client.force_authenticate(user=self.student)
        payload = {
            "lat": 33.6428,
            "lng": 72.9904
        }
        response = self.client.post("/api/safety/sos/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Verify SOSEvent was created in DB
        self.assertEqual(SOSEvent.objects.filter(user=self.student).count(), 1)
        event = SOSEvent.objects.filter(user=self.student).first()
        self.assertEqual(event.status, "active")
        self.assertEqual(event.latitude, 33.6428)
        self.assertEqual(event.longitude, 72.9904)

    def test_admin_list_sos_events(self):
        # Create an event in DB
        SOSEvent.objects.create(user=self.student, latitude=33.6428, longitude=72.9904, status="active")
        
        # Unauthorized access check
        self.client.force_authenticate(user=self.student)
        response = self.client.get("/api/safety/sos/admin_list/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # Admin access check
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/safety/sos/admin_list/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["user_details"]["username"], "student_sos")

    def test_admin_resolve_sos_event(self):
        # Create an event in DB
        event = SOSEvent.objects.create(user=self.student, latitude=33.6428, longitude=72.9904, status="active")
        
        # Unauthorized resolve check
        self.client.force_authenticate(user=self.student)
        response = self.client.post(f"/api/safety/sos/{event.id}/resolve/")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        
        # Admin resolve check
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/safety/sos/{event.id}/resolve/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        # Verify status updated
        event.refresh_from_db()
        self.assertEqual(event.status, "resolved")


