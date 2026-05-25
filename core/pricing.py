import math
from datetime import datetime, time

def haversine_distance(lat1, lng1, lat2, lng2):
    """
    Calculate the great-circle distance between two points on the Earth 
    using the Haversine formula. Returns distance in kilometers.
    """
    R = 6371.0  # Earth radius in kilometers

    lat1_rad = math.radians(lat1)
    lng1_rad = math.radians(lng1)
    lat2_rad = math.radians(lat2)
    lng2_rad = math.radians(lng2)

    dlat = lat2_rad - lat1_rad
    dlng = lng2_rad - lng1_rad

    a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlng / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c

def is_rush_hour(ride_time_str, ride_date_str=None):
    """
    Check if the ride falls during peak traffic times:
    Morning Rush: 07:30 - 09:30
    Evening Rush: 16:30 - 18:30
    (Usually applies on weekdays)
    """
    try:
        # Parse time (HH:MM or HH:MM:SS)
        t_parts = [int(p) for p in ride_time_str.split(':')[:2]]
        r_time = time(t_parts[0], t_parts[1])
        
        morning_start = time(7, 30)
        morning_end = time(9, 30)
        evening_start = time(16, 30)
        evening_end = time(18, 30)
        
        in_time_range = (morning_start <= r_time <= morning_end) or (evening_start <= r_time <= evening_end)
        
        # Optionally check if weekday
        if ride_date_str:
            dt = datetime.strptime(ride_date_str, "%Y-%m-%d")
            is_weekday = dt.weekday() < 5
            return in_time_range and is_weekday
            
        return in_time_range
    except Exception:
        return False

def get_price_prediction(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, ride_time_str, ride_date_str, vehicle_model, seats_total, override_distance_km=None, vehicle_type='car'):
    """
    AI/ML pricing engine that estimates a fair carpool price per seat.
    """
    # 1. Calculate distance
    if override_distance_km is not None:
        try:
            distance_km = float(override_distance_km)
        except (ValueError, TypeError):
            distance_km = haversine_distance(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
    else:
        distance_km = haversine_distance(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
    
    # Ensure minimum distance is at least 0.5 km to prevent divide by zero
    distance_km = max(distance_km, 0.5)

    # 2. Base components (in PKR)
    if vehicle_type == 'motorbike':
        base_fare = 50.0
        price_per_km = 8.0
    else:
        base_fare = 150.0  # Fixed vehicle wear & tear starting cost in PKR
        price_per_km = 20.0  # Fuel/maintenance cost per km in PKR
    raw_distance_fare = distance_km * price_per_km

    # 3. Vehicle multiplier
    if vehicle_type == 'motorbike':
        vehicle_multiplier = 1.00
        vehicle_type_desc = "Motorbike (Budget 2-Wheel)"
    else:
        # Determine type by simple keyword matching on the model string
        v_model_lower = vehicle_model.lower()
        if any(k in v_model_lower for k in ['hybrid', 'tesla', 'electric', 'ev', 'prius', 'leaf']):
            vehicle_multiplier = 0.85
            vehicle_type_desc = "Eco-Friendly / Electric (15% Off)"
        elif any(k in v_model_lower for k in ['suv', 'truck', 'jeep', 'crossover', 'van', 'crv', 'rav4']):
            vehicle_multiplier = 1.20
            vehicle_type_desc = "SUV / Large Vehicle (20% Premium)"
        elif any(k in v_model_lower for k in ['compact', 'hatchback', 'yaris', 'fit', 'civic']):
            vehicle_multiplier = 0.90
            vehicle_type_desc = "Compact / Budget (10% Off)"
        else:
            vehicle_multiplier = 1.00
            vehicle_type_desc = "Standard Sedan (1.0x)"

    # 4. Traffic multiplier
    if is_rush_hour(ride_time_str, ride_date_str):
        traffic_multiplier = 1.30
        traffic_status = "Rush Hour Traffic (+30%)"
    else:
        traffic_multiplier = 1.00
        traffic_status = "Normal Traffic (1.0x)"

    # 5. Demand multiplier (weekend check)
    demand_multiplier = 1.00
    demand_status = "Standard Student Demand"
    try:
        dt = datetime.strptime(ride_date_str, "%Y-%m-%d")
        if dt.weekday() >= 5:  # Saturday or Sunday
            demand_multiplier = 1.10
            demand_status = "Weekend Leisure Demand (+10%)"
        elif dt.month in [5, 12]:  # Exam / Holiday months
            demand_multiplier = 1.15
            demand_status = "Exam/Holiday Travel Peak (+15%)"
    except Exception:
        pass

    # 6. Seat Cost Sharing Discount
    if vehicle_type == 'motorbike':
        seat_factor = 1.0
    else:
        # Share expenses among passengers. More seats = split cost, but incentivized
        # Standard formula is total ride cost / (expected occupancy). 
        # For a typical carpool, we assume driver is commuting anyway, so seats_total determines discount factor
        seat_factor = 1.0
        if seats_total >= 6:
            seat_factor = 0.80  # Large group discount
        elif seats_total >= 4:
            seat_factor = 0.90
        elif seats_total <= 2:
            seat_factor = 1.10  # Single passenger premium

    # 7. Total Ride Cost Calculation
    total_ride_cost = (base_fare + raw_distance_fare) * vehicle_multiplier * traffic_multiplier * demand_multiplier
    
    # Per Seat Recommended Price
    if vehicle_type == 'motorbike':
        expected_occupants = 1.0
    else:
        expected_occupants = max(seats_total * 0.6, 1.0)
    recommended_per_seat = (total_ride_cost * seat_factor) / expected_occupants
    
    # Cap the recommended price to reasonable bounds in PKR (min Rs. 50 per seat)
    recommended_per_seat = round(max(recommended_per_seat, 50.00), 2)

    # Round components for representation
    return {
        'recommended_price': recommended_per_seat,
        'distance_km': round(distance_km, 2),
        'base_fare': round(base_fare, 2),
        'distance_fare': round(raw_distance_fare, 2),
        'vehicle_type': vehicle_type_desc,
        'vehicle_multiplier': vehicle_multiplier,
        'traffic_status': traffic_status,
        'traffic_multiplier': traffic_multiplier,
        'demand_status': demand_status,
        'demand_multiplier': demand_multiplier,
        'seat_factor': seat_factor,
        'explanation': (
            f"Suggested price: Rs. {recommended_per_seat:.2f} per seat. "
            f"Based on a {distance_km:.1f} km trip, using a {vehicle_type_desc}. "
            f"Adjusted for {traffic_status} and {demand_status}."
        )
    }
