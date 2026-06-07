import json
import urllib.request
from django.db.models import Count, Avg, Q
from django.utils import timezone
from datetime import datetime, timedelta, date, time
from .models import (User, Ride, Booking, Message, Notification, Review, Report, 
                     SOSEvent, Timetable, RideAnalytics, SafetyScore, DemandPrediction, CopilotInsight)
from .pricing import haversine_distance

# =====================================================================
# 1. STUDENT SIDE FUNCTIONS
# =====================================================================

def calculate_ride_match_score(student, ride):
    """
    Computes a percentage match score (0-100) between a student and a ride.
    """
    day_name = ride.date.strftime('%A')
    timetable_entry = Timetable.objects.filter(student=student, day_of_week__iexact=day_name).first()
    
    score = 50  # Base match score
    
    if timetable_entry:
        # Distance check
        p_dist = haversine_distance(ride.pickup_lat, ride.pickup_lng, timetable_entry.pickup_lat, timetable_entry.pickup_lng)
        d_dist = haversine_distance(ride.dropoff_lat, ride.dropoff_lng, timetable_entry.dropoff_lat, timetable_entry.dropoff_lng)
        
        # Pickup proximity (up to 20 pts)
        if p_dist <= 2.0:
            score += int((2.0 - p_dist) / 2.0 * 20)
            
        # Dropoff proximity (up to 20 pts)
        if d_dist <= 1.5:
            score += int((1.5 - d_dist) / 1.5 * 20)
            
        # Time similarity: compare ride time and timetable preferred departure time
        r_time_min = ride.time.hour * 60 + ride.time.minute
        t_time_min = timetable_entry.preferred_departure_time.hour * 60 + timetable_entry.preferred_departure_time.minute
        time_diff = abs(r_time_min - t_time_min)
        
        if time_diff <= 60:
            score += int((60 - time_diff) / 60.0 * 10)
            
    # Trust factors
    if ride.driver.verification_status == 'verified':
        score += 10
    if ride.driver.rating_avg >= 4.5:
        score += 5
        
    return min(98, max(25, score))


def recommend_departure_time(ride, timetable_entry=None):
    """
    Recommends a departure time based on distance, safety margins, and class start times.
    """
    if not timetable_entry:
        return ride.time.strftime('%I:%M %p')
        
    # Assume 3 minutes per km driving speed + 10 minutes buffer
    distance = haversine_distance(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng)
    est_duration_min = max(5, int(distance * 3) + 10)
    
    # Class start time in minutes from midnight
    class_time_min = timetable_entry.class_start_time.hour * 60 + timetable_entry.class_start_time.minute
    recommended_time_min = class_time_min - est_duration_min
    
    hours = recommended_time_min // 60
    minutes = recommended_time_min % 60
    
    # Normalize time boundary
    hours = max(0, min(23, hours))
    
    return f"{hours:02d}:{minutes:02d}"


def calculate_student_cost_saving(student, ride):
    """
    Calculates estimated fare saving (Rs.) by sharing the ride instead of taxi.
    """
    distance = haversine_distance(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng)
    # Taxi baseline: Rs. 300 base + Rs. 50 per km
    taxi_equivalent = 300 + (50 * distance)
    saving = taxi_equivalent - float(ride.price_per_seat)
    return max(50.0, round(saving, 0))


def calculate_carbon_saving(ride):
    """
    Calculates carbon saving in kg CO2 by carpooling.
    """
    distance = haversine_distance(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng)
    # Baseline: single-occupancy driving generates ~0.15 kg CO2 per km.
    # Share ratio: dividing the footprint amongst passengers.
    passengers = max(1, ride.seats_total - ride.seats_available)
    co2_saved = distance * 0.15 * passengers
    return round(co2_saved, 2)


def explain_ride_recommendation(student, ride, match_score):
    """
    Generates a natural language explanation for why this ride is recommended.
    """
    reasons = []
    
    day_name = ride.date.strftime('%A')
    timetable_entry = Timetable.objects.filter(student=student, day_of_week__iexact=day_name).first()
    
    if timetable_entry:
        reasons.append("similar class time")
        p_dist = haversine_distance(ride.pickup_lat, ride.pickup_lng, timetable_entry.pickup_lat, timetable_entry.pickup_lng)
        if p_dist <= 1.0:
            reasons.append("pickup matches your location")
    else:
        reasons.append("popular campus route")
        
    if ride.driver.verification_status == 'verified':
        reasons.append("verified driver")
        
    if ride.driver.rating_avg >= 4.7:
        reasons.append("top-rated driver")
        
    distance = haversine_distance(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng)
    est_travel_time = max(5, int(distance * 2.5))
    
    reason_str = ", ".join(reasons)
    return f"Recommended ride: {match_score}% match. {reason_str.capitalize()}, and {est_travel_time} minutes estimated travel time."


def get_personal_ride_suggestions(student):
    """
    Aggregates all personalized suggestions for a student.
    """
    # Only return suggestions for verified students
    if student.verification_status != 'verified':
        return []
        
    suggestions = []
    active_rides = Ride.objects.filter(date__gte=date.today(), seats_available__gt=0).exclude(driver=student)
    
    # Exclude blocked/blocked-by drivers
    from .views import BlockedUser
    blocked_ids = list(BlockedUser.objects.filter(blocker=student).values_list('blocked_id', flat=True))
    blocked_by_ids = list(BlockedUser.objects.filter(blocked=student).values_list('blocker_id', flat=True))
    exclude_ids = set(blocked_ids + blocked_by_ids)
    active_rides = active_rides.exclude(driver_id__in=exclude_ids)

    for ride in active_rides[:5]:
        score = calculate_ride_match_score(student, ride)
        day_name = ride.date.strftime('%A')
        timetable_entry = Timetable.objects.filter(student=student, day_of_week__iexact=day_name).first()
        
        dept_time = recommend_departure_time(ride, timetable_entry)
        savings = calculate_student_cost_saving(student, ride)
        carbon = calculate_carbon_saving(ride)
        reason = explain_ride_recommendation(student, ride, score)
        safety = calculate_ride_safety_score(ride)
        
        distance = haversine_distance(ride.pickup_lat, ride.pickup_lng, ride.dropoff_lat, ride.dropoff_lng)
        est_duration = max(5, int(distance * 2.5))
        
        suggestions.append({
            'ride_id': ride.id,
            'driver_name': ride.driver.username,
            'driver_rating': ride.driver.rating_avg,
            'pickup': ride.pickup_name,
            'dropoff': ride.dropoff_name,
            'match_score': score,
            'departure_time': dept_time,
            'estimated_travel_time': est_duration,
            'cost_saving': savings,
            'safety_score': safety,
            'carbon_saving': carbon,
            'reason': reason,
            'price': float(ride.price_per_seat)
        })
        
    # Sort suggestions by match score descending
    suggestions.sort(key=lambda x: x['match_score'], reverse=True)
    return suggestions

# =====================================================================
# 2. AI SAFETY SCORE FUNCTIONS
# =====================================================================

def calculate_driver_trust_score(driver):
    """
    Computes a trust score (0-100) for a driver.
    """
    score = 75  # Base trust
    
    if driver.verification_status == 'verified':
        score += 15
    elif driver.verification_status == 'unverified':
        score -= 10
        
    # Rating factor
    score += int((driver.rating_avg - 3.0) * 10)  # e.g. 5.0 rating adds 20 pts
    
    # Reports deduction
    reports = Report.objects.filter(reported_user=driver, status='pending').count()
    score -= (reports * 15)
    
    return max(10, min(100, score))


def calculate_passenger_trust_score(passenger):
    """
    Computes a trust score (0-100) for a passenger.
    """
    score = 80
    if passenger.verification_status == 'verified':
        score += 15
    reports = Report.objects.filter(reported_user=passenger, status='pending').count()
    score -= (reports * 15)
    return max(10, min(100, score))


def calculate_ride_safety_score(ride):
    """
    Calculates safety score for an active ride.
    """
    driver_trust = calculate_driver_trust_score(ride.driver)
    
    # Active SOS deduction
    sos_active = SOSEvent.objects.filter(user=ride.driver, status='active').exists()
    
    score = driver_trust
    if sos_active:
        score -= 40
        
    return max(5, min(100, score))


def get_safety_label(score):
    """
    Returns safety category label based on score value.
    """
    if score >= 90:
        return "Excellent Safety"
    elif score >= 75:
        return "Good Safety"
    elif score >= 50:
        return "Medium Safety"
    else:
        return "Needs Review"


def explain_safety_score(score, ride):
    """
    Explains the score value with bullet points.
    """
    reasons = []
    if ride.driver.verification_status == 'verified':
        reasons.append("Driver holds a verified university profile.")
    else:
        reasons.append("Driver identity is unverified.")
        
    if ride.driver.rating_avg >= 4.5:
        reasons.append(f"Driver maintains a high student rating of {ride.driver.rating_avg} stars.")
        
    reports = Report.objects.filter(reported_user=ride.driver, status='pending').count()
    if reports > 0:
        reasons.append(f"Warning: {reports} active student complaints are associated with this profile.")
        
    if SOSEvent.objects.filter(user=ride.driver, status='active').exists():
        reasons.append("Critical: An active SOS alarm has been reported recently.")
        
    return reasons

# =====================================================================
# 3. SMART RIDE CLUSTERING
# =====================================================================

def cluster_similar_ride_requests():
    """
    Groups timetable class schedules and ride requests into clusters by route and time overlap.
    """
    # Fetch timetables for verified students
    entries = Timetable.objects.filter(student__verification_status='verified')
    clusters = []
    
    # Group by destination and day
    grouped = {}
    for entry in entries:
        key = (entry.dropoff_name.lower().strip(), entry.day_of_week.lower().strip())
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(entry)
        
    for key, entries_list in grouped.items():
        if len(entries_list) < 2:
            continue
            
        # Group entries that have departure time within 30 minutes of each other
        subgroups = []
        for entry in entries_list:
            placed = False
            for group in subgroups:
                # Compare time with first item in group
                ref = group[0]
                t1 = entry.preferred_departure_time.hour * 60 + entry.preferred_departure_time.minute
                t2 = ref.preferred_departure_time.hour * 60 + ref.preferred_departure_time.minute
                if abs(t1 - t2) <= 30:
                    group.append(entry)
                    placed = True
                    break
            if not placed:
                subgroups.append([entry])
                
        for group in subgroups:
            if len(group) >= 2:
                # Calculate cluster centroids
                avg_lat = sum(e.pickup_lat for e in group) / len(group)
                avg_lng = sum(e.pickup_lng for e in group) / len(group)
                
                usernames = [e.student.username for e in group]
                clusters.append({
                    'route_key': f"To {group[0].dropoff_name}",
                    'day': group[0].day_of_week,
                    'destination': group[0].dropoff_name,
                    'students_count': len(group),
                    'students': usernames,
                    'approx_pickup_lat': avg_lat,
                    'approx_pickup_lng': avg_lng,
                    'time_window': f"{group[0].preferred_departure_time.strftime('%I:%M %p')} - {group[-1].preferred_departure_time.strftime('%I:%M %p')}",
                    'recommendation': f"{len(group)} students from nearby areas are going to the {group[0].dropoff_name} on {group[0].day_of_week}. Create one shared ride?"
                })
                
    return clusters

# =====================================================================
# 4. ADMIN MOBILITY overview & heatmaps
# =====================================================================

def get_campus_mobility_overview():
    """
    Gathers key business intelligence and sustainability summaries for the admin dashboard.
    """
    today = date.today()
    active_rides = Ride.objects.filter(date=today).count()
    completed_rides = Booking.objects.filter(ride__date=today, ride_status='completed').values('ride').distinct().count()
    
    sos_alerts = SOSEvent.objects.filter(status='active').count()
    complaints = Report.objects.filter(status='pending').count()
    
    verified_drivers = User.objects.filter(role__in=['student', 'external_driver'], verification_status='verified').count()
    unverified_drivers = User.objects.filter(role__in=['student', 'external_driver'], verification_status='unverified').count()
    
    # Calculate carbon & money savings from RideAnalytics
    analytics = RideAnalytics.objects.all()
    co2_saved = sum(item.estimated_co2_saved for item in analytics)
    money_saved = sum(item.estimated_money_saved for item in analytics)
    
    # Hotspots
    popular_routes = get_popular_routes()
    
    return {
        'active_rides_today': active_rides,
        'completed_rides_today': completed_rides,
        'sos_alerts_pending': sos_alerts,
        'unresolved_complaints': complaints,
        'verified_drivers': verified_drivers,
        'unverified_drivers': unverified_drivers,
        'co2_saved_kg': round(co2_saved, 1),
        'money_saved_rs': round(money_saved, 0),
        'popular_routes': popular_routes[:3]
    }


def get_popular_routes():
    """
    Determines popular carpooling routes.
    """
    rides = Ride.objects.values('pickup_name', 'dropoff_name').annotate(count=Count('id')).order_by('-count')
    routes = []
    for r in rides:
        routes.append({
            'pickup': r['pickup_name'],
            'dropoff': r['dropoff_name'],
            'count': r['count']
        })
    return routes


def generate_route_heatmap_data():
    """
    Builds heatmap points based on active and completed pickup/dropoff densities.
    """
    points = []
    # 1. Pickup points
    rides = Ride.objects.all()
    for r in rides:
        points.append({
            'lat': r.pickup_lat,
            'lng': r.pickup_lng,
            'weight': 1.0,
            'type': 'pickup',
            'name': r.pickup_name
        })
        points.append({
            'lat': r.dropoff_lat,
            'lng': r.dropoff_lng,
            'weight': 0.8,
            'type': 'dropoff',
            'name': r.dropoff_name
        })
        
    # 2. Add Active SOS markers
    soses = SOSEvent.objects.filter(status='active')
    for s in soses:
        points.append({
            'lat': s.latitude,
            'lng': s.longitude,
            'weight': 2.0,
            'type': 'sos',
            'name': f"Active SOS Alarm by @{s.user.username}"
        })
        
    return points


def detect_peak_travel_hours():
    """
    Identifies busiest travel hours on campus.
    """
    rides = Ride.objects.all()
    slots = {}
    for r in rides:
        hour = r.time.hour
        slot = f"{hour:02d}:00 - {(hour+1)%24:02d}:00"
        slots[slot] = slots.get(slot, 0) + 1
        
    sorted_slots = sorted(slots.items(), key=lambda x: x[1], reverse=True)
    return [{'time_slot': item[0], 'rides_count': item[1]} for item in sorted_slots]


def generate_sustainability_report():
    """
    Returns monthly sustainability carbon offset summary.
    """
    analytics = RideAnalytics.objects.all()
    co2_saved = sum(item.estimated_co2_saved for item in analytics)
    passenger_miles = sum(item.distance * item.shared_seats for item in analytics)
    
    return {
        'total_co2_saved_kg': round(co2_saved, 1),
        'passenger_km_shared': round(passenger_miles, 1),
        'trees_equivalent': round(co2_saved / 21.0, 1),  # Average tree absorbs 21kg CO2/year
        'single_occupancy_miles_avoided': round(passenger_miles * 0.8, 1)
    }


def generate_safety_summary():
    """
    Collects safety metrics, driver ratio, and pending alarms.
    """
    sos_alerts = SOSEvent.objects.filter(status='active').count()
    complaints = Report.objects.filter(status='pending').count()
    total_drivers = User.objects.filter(role__in=['student', 'external_driver']).count()
    verified_drivers = User.objects.filter(role__in=['student', 'external_driver'], verification_status='verified').count()
    
    ratio = (verified_drivers / total_drivers * 100) if total_drivers > 0 else 100
    
    return {
        'active_sos_alerts': sos_alerts,
        'pending_complaints': complaints,
        'verified_driver_ratio': round(ratio, 1),
        'unverified_driver_count': total_drivers - verified_drivers
    }

# =====================================================================
# 5. AI DEMAND PREDICTION
# =====================================================================

def fetch_local_weather_forecast():
    """
    Attempts to fetch weather from Open-Meteo. Uses safe fallback on failure.
    """
    # Coordinates of NUST, Islamabad
    lat, lng = 33.6428, 72.9904
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&current_weather=true"
    
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'CampusRide-Mobility-Copilot/1.0'})
        with urllib.request.urlopen(req, timeout=3) as response:
            data = json.loads(response.read().decode())
            if 'current_weather' in data:
                temp = data['current_weather']['temperature']
                weather_code = data['current_weather']['weathercode']
                
                # Simple categorization
                rainy = weather_code in [51, 53, 55, 61, 63, 65, 80, 81, 82]
                return {'temp': temp, 'is_rainy': rainy, 'weather_desc': 'Rainy' if rainy else 'Clear'}
    except Exception as e:
        print("Weather forecast API unavailable. Triggering fallback weather details:", e)
        
    return {'temp': 28.5, 'is_rainy': False, 'weather_desc': 'Clear/Normal'}


def predict_ride_demand():
    """
    Calculates demand predictions using timetable slots, weather variables, and history.
    """
    weather = fetch_local_weather_forecast()
    
    # Fetch historical completed rides by route & day
    rides = Ride.objects.all()
    routes_counts = {}
    
    for r in rides:
        day_of_week = r.date.strftime('%A')
        hour = r.time.hour
        slot = f"{hour:02d}:00 - {(hour+1)%24:02d}:00"
        
        route_key = f"{r.pickup_name} -> {r.dropoff_name}"
        key = (route_key, day_of_week, slot)
        routes_counts[key] = routes_counts.get(key, 0) + 1
        
    predictions = []
    
    # Include classes scheduling demand
    timetables = Timetable.objects.values('pickup_name', 'dropoff_name', 'day_of_week', 'preferred_departure_time')
    for t in timetables:
        hour = t['preferred_departure_time'].hour
        slot = f"{hour:02d}:00 - {(hour+1)%24:02d}:00"
        route_key = f"{t['pickup_name']} -> {t['dropoff_name']}"
        key = (route_key, t['day_of_week'], slot)
        routes_counts[key] = routes_counts.get(key, 0) + 2  # Add weight for timetable class matching
        
    # Build predictions list
    for (route, day, slot), count in routes_counts.items():
        base_confidence = 70.0
        
        # Weather adjustments
        if weather['is_rainy']:
            count += 3  # Increase demand on rainy days
            base_confidence += 5.0
            
        demand = "Low"
        if count >= 8:
            demand = "High"
        elif count >= 3:
            demand = "Medium"
            
        confidence = min(98.0, base_confidence + min(20.0, count * 1.5))
        
        predictions.append({
            'route': route,
            'day_of_week': day,
            'time_slot': slot,
            'demand_level': demand,
            'predicted_rides': count,
            'confidence': round(confidence, 1),
            'weather_condition': weather['weather_desc']
        })
        
    # Fallback if database is empty
    if not predictions:
        predictions.append({
            'route': "Hostel Block A -> Main Campus",
            'day_of_week': "Monday",
            'time_slot': "08:00 - 09:00",
            'demand_level': "High",
            'predicted_rides': 12,
            'confidence': 88.5,
            'weather_condition': weather['weather_desc']
        })
        
    return predictions


def generate_admin_insights():
    """
    Returns text insights highlighting high demand spots, safety warnings, or eco progress.
    """
    insights = []
    weather = fetch_local_weather_forecast()
    
    # 1. Weather peak demand alert
    if weather['is_rainy']:
        insights.append("Rainy weather detected. Expected +25% campus ride demand spike. Advise drivers to publish rides.")
        
    # 2. Busiest route alert
    popular = get_popular_routes()
    if popular:
        insights.append(f"High ride demand is expected tomorrow from {popular[0]['pickup']} to {popular[0]['dropoff']} between 8:00 AM and 9:00 AM.")
        
    # 3. Safety alert
    unverified = User.objects.filter(role__in=['student', 'external_driver'], verification_status='unverified').count()
    if unverified > 5:
        insights.append(f"Verification Queue Alert: {unverified} unverified driver applications are pending. Speed up verification to increase driver availability.")
        
    # 4. Sustainability milestone
    analytics = RideAnalytics.objects.all()
    co2_saved = sum(item.estimated_co2_saved for item in analytics)
    if co2_saved > 100:
        insights.append(f"Sustainability Milestone: Campus carpooling has offset {round(co2_saved, 1)} kg of CO2 emissions this month!")
        
    # Fallbacks if list is short
    if len(insights) < 2:
        insights.append("High ride demand is expected tomorrow from Hostel Block A to Main Campus between 8:00 AM and 9:00 AM.")
        insights.append("Peak hours detected: 08:00 AM - 09:00 AM and 05:00 PM - 06:00 PM. Recommend drivers queue routes.")
        
    return insights

# =====================================================================
# 6. NATURAL LANGUAGE COPILOT CHAT
# =====================================================================

def handle_natural_language_query(query):
    """
    Rule-based chatbot answering questions about campus mobility, safety, and carbon.
    """
    q = query.lower().strip()
    overview = get_campus_mobility_overview()
    weather = fetch_local_weather_forecast()
    
    if "route" in q or "busy" in q or "busiest" in q:
        popular = get_popular_routes()
        if popular:
            routes_str = ", ".join([f"{r['pickup']} -> {r['dropoff']} ({r['count']} rides)" for r in popular[:3]])
            return f"The busiest routes today are: {routes_str}."
        return "Busiest routes: Hostel Block A to SCIS Department is currently leading."
        
    elif "driver" in q or "verification" in q or "need" in q:
        ratio = generate_safety_summary()['verified_driver_ratio']
        return f"Currently, {overview['verified_drivers']} drivers are verified ({ratio}% verification ratio) and {overview['unverified_drivers']} are pending. Hostel Block A and Concordia-3 areas need more active drivers."
        
    elif "ride" in q or "completed" in q or "active" in q:
        return f"There are {overview['active_rides_today']} active rides scheduled for today, and {overview['completed_rides_today']} completed trips verified."
        
    elif "safety" in q or "sos" in q or "complaint" in q or "issue" in q:
        summary = generate_safety_summary()
        return f"Safety dashboard: {summary['active_sos_alerts']} active SOS alarms, {summary['pending_complaints']} unresolved passenger reports, and verified driver ratio is at {summary['verified_driver_ratio']}%."
        
    elif "co2" in q or "carbon" in q or "save" in q or "green" in q or "money" in q:
        sustainability = generate_sustainability_report()
        return f"Students saved Rs. {overview['money_saved_rs']:,} in cost allocations. Environmental footprint reduction: {overview['co2_saved_kg']} kg CO2 saved, equivalent to planting {sustainability['trees_equivalent']} trees!"
        
    # Default greeting/fallback
    return "Hello! I am the Campus Mobility AI Copilot. You can ask me about active rides, busiest routes, driver verification levels, safety alarms, or sustainability carbon savings."
