from .pricing import haversine_distance
import itertools

def project_point_on_segment(px, py, ax, ay, bx, by):
    """
    Project point P(px, py) onto segment AB(ax, ay -> bx, by).
    Returns the projection factor t (0 <= t <= 1 if projection is on segment)
    and the coordinates of the projected point.
    """
    # Vector AB
    abx = bx - ax
    aby = by - ay
    
    # Vector AP
    apx = px - ax
    apy = py - ay
    
    ab_len_sq = abx*abx + aby*aby
    if ab_len_sq == 0:
        return 0.0, (ax, ay)
        
    # Project AP onto AB
    t = (apx*abx + apy*aby) / ab_len_sq
    # Clamp t to segment bounds
    t_clamped = max(0.0, min(1.0, t))
    
    proj_x = ax + t_clamped * abx
    proj_y = ay + t_clamped * aby
    
    return t, (proj_x, proj_y)

def check_route_match(p_pickup, p_dropoff, d_pickup, d_dropoff, max_dist_km=2.0):
    """
    Check if a passenger's pickup and dropoff points are 'along' the driver's path.
    Coordinates format: (lat, lng)
    """
    p1_lat, p1_lng = p_pickup
    p2_lat, p2_lng = p_dropoff
    d1_lat, d1_lng = d_pickup
    d2_lat, d2_lng = d_dropoff
    
    # 1. Project passenger pickup onto driver path
    t_pick, proj_pick = project_point_on_segment(
        p1_lat, p1_lng,
        d1_lat, d1_lng,
        d2_lat, d2_lng
    )
    
    # 2. Project passenger dropoff onto driver path
    t_drop, proj_drop = project_point_on_segment(
        p2_lat, p2_lng,
        d1_lat, d1_lng,
        d2_lat, d2_lng
    )
    
    # 3. Calculate Haversine distances to the projected points
    dist_pick = haversine_distance(p1_lat, p1_lng, proj_pick[0], proj_pick[1])
    dist_drop = haversine_distance(p2_lat, p2_lng, proj_drop[0], proj_drop[1])
    
    # 4. Check conditions
    # - Passenger pickup is close to driver path
    # - Passenger dropoff is close to driver path
    # - Passenger pickup occurs before dropoff along the driver's path (t_pick < t_drop)
    # - They are moving in the same general direction
    is_close = (dist_pick <= max_dist_km) and (dist_drop <= max_dist_km)
    correct_order = t_pick < t_drop
    
    # Calculate score (lower is better matching)
    match_score = dist_pick + dist_drop
    
    # If the endpoints are very close to driver's endpoints, mark as high compatibility
    direct_pickup_dist = haversine_distance(p1_lat, p1_lng, d1_lat, d1_lng)
    direct_dropoff_dist = haversine_distance(p2_lat, p2_lng, d2_lat, d2_lng)
    is_direct = (direct_pickup_dist <= max_dist_km) and (direct_dropoff_dist <= max_dist_km)
    
    return {
        'is_match': is_close and correct_order,
        'is_direct': is_direct,
        'pickup_deviation_km': round(dist_pick, 2),
        'dropoff_deviation_km': round(dist_drop, 2),
        'match_score': round(match_score, 2),
        't_pickup': t_pick,
        't_dropoff': t_drop
    }

def optimize_driver_route(driver_start, driver_end, bookings):
    """
    Given driver start (lat, lng), driver end (lat, lng), and a list of approved bookings.
    Each booking is a dict: { 'id': int, 'passenger_name': str, 'pickup': (lat, lng), 'dropoff': (lat, lng) }
    
    Finds the optimal sequence of stops to minimize total distance, enforcing that 
    each passenger's pickup must be visited before their dropoff.
    
    Returns:
        - sorted_stops: list of dicts describing the route in order
        - total_distance_km: total route distance
    """
    # If no bookings, route is just start -> end
    if not bookings:
        dist = haversine_distance(driver_start[0], driver_start[1], driver_end[0], driver_end[1])
        return [
            {'type': 'start', 'name': 'Driver Start', 'coords': driver_start},
            {'type': 'end', 'name': 'Driver End', 'coords': driver_end}
        ], round(dist, 2)
        
    # Generate list of all intermediate locations to visit
    # We have 2N locations: N pickups and N dropoffs.
    # We want to find a permutation of these 2N locations that starts at driver_start, 
    # ends at driver_end, and respects the constraint: pickup_i comes before dropoff_i.
    
    locations = []
    for b in bookings:
        locations.append({'id': b['id'], 'type': 'pickup', 'name': f"Pick up {b['passenger_name']}", 'coords': b['pickup']})
        locations.append({'id': b['id'], 'type': 'dropoff', 'name': f"Drop off {b['passenger_name']}", 'coords': b['dropoff']})
        
    num_locations = len(locations)
    
    # If N is small (e.g. up to 3 bookings = 6 locations), we can check all permutations (6! = 720 options)
    # This is extremely fast and gives the exact global optimum.
    best_path = None
    min_dist = float('inf')
    
    for perm in itertools.permutations(locations):
        # Validate constraint: for each booking ID, pickup must precede dropoff in the permutation
        valid = True
        visited_pickups = set()
        for loc in perm:
            if loc['type'] == 'pickup':
                visited_pickups.add(loc['id'])
            elif loc['type'] == 'dropoff':
                if loc['id'] not in visited_pickups:
                    valid = False
                    break
        if not valid:
            continue
            
        # Calculate total distance for this sequence: Start -> perm[0] -> ... -> perm[n-1] -> End
        current_dist = 0
        current_node = driver_start
        
        for loc in perm:
            current_dist += haversine_distance(current_node[0], current_node[1], loc['coords'][0], loc['coords'][1])
            current_node = loc['coords']
            
        current_dist += haversine_distance(current_node[0], current_node[1], driver_end[0], driver_end[1])
        
        if current_dist < min_dist:
            min_dist = current_dist
            best_path = perm
            
    # Format the final route
    route = [{'type': 'start', 'name': 'Driver Start', 'coords': driver_start}]
    for loc in best_path:
        route.append(loc)
    route.append({'type': 'end', 'name': 'Driver End', 'coords': driver_end})
    
    return route, round(min_dist, 2)
