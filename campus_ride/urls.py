"""
URL configuration for campus_ride project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from core import views

urlpatterns = [
    # Admin Interface
    path('admin/', admin.site.urls),

    # Main SPA Entry Point
    path('', views.index_view, name='index'),

    # API Endpoints
    path('api/register/', views.register_view, name='api_register'),
    path('api/login/', views.login_view, name='api_login'),
    path('api/logout/', views.logout_view, name='api_logout'),
    path('api/me/', views.me_view, name='api_me'),
    path('api/verify-profile/', views.verify_profile_view, name='api_verify_profile'),

    path('api/rides/', views.rides_view, name='api_rides'),
    path('api/rides/<int:pk>/', views.ride_detail_view, name='api_ride_detail'),
    path('api/rides/price-predict/', views.price_predict_view, name='api_price_predict'),
    path('api/rides/matching/', views.rides_matching_view, name='api_rides_matching'),

    path('api/bookings/', views.bookings_view, name='api_bookings'),
    path('api/bookings/<int:pk>/action/', views.booking_action_view, name='api_booking_action'),

    path('api/chat/messages/', views.chat_messages_view, name='api_chat_messages'),
    path('api/chat/conversations/', views.chat_conversations_view, name='api_chat_conversations'),

    path('api/notifications/', views.notifications_view, name='api_notifications'),
    path('api/notifications/mark-read/', views.mark_notifications_read_view, name='api_notifications_mark_read'),

    path('api/safety/review/', views.review_ride_view, name='api_review_ride'),
    path('api/safety/report/', views.report_user_view, name='api_report_user'),
    path('api/safety/block/', views.block_user_view, name='api_block_user'),
    path('api/safety/sos/', views.sos_emergency_view, name='api_sos_emergency'),

    # Admin Moderation API Endpoints
    path('api/safety/reports/admin_list/', views.admin_reports_list, name='api_admin_reports_list'),
    path('api/safety/users/admin_list/', views.admin_users_list, name='api_admin_users_list'),
    path('api/safety/reports/<int:pk>/resolve/', views.resolve_report_admin, name='api_resolve_report_admin'),
    path('api/safety/users/<int:pk>/moderate/', views.moderate_user_admin, name='api_moderate_user_admin'),
    path('api/safety/sos/admin_list/', views.admin_sos_list, name='api_admin_sos_list'),
    path('api/safety/sos/<int:pk>/resolve/', views.resolve_sos_admin, name='api_resolve_sos_admin'),
]

