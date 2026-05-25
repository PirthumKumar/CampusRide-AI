from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import User, Ride, Booking, Message, Notification, Review, Report, BlockedUser

@admin.action(description="Verify selected students")
def verify_students(modeladmin, request, queryset):
    queryset.update(verification_status='verified')

@admin.action(description="Reject verification for selected students")
def reject_verification(modeladmin, request, queryset):
    queryset.update(verification_status='unverified')

class CustomUserAdmin(UserAdmin):
    model = User
    list_display = ('username', 'email', 'university', 'phone', 'verification_status', 'rating_avg', 'is_staff')
    list_filter = ('verification_status', 'is_staff', 'is_superuser', 'gender')
    search_fields = ('username', 'email', 'first_name', 'last_name', 'university')
    actions = [verify_students, reject_verification]
    
    # Expose custom fields in admin detail forms
    fieldsets = UserAdmin.fieldsets + (
        ('CampusRide Info', {
            'fields': ('phone', 'university', 'gender', 'avatar_url', 'verification_status', 'verification_doc', 'emergency_contact', 'rating_avg'),
        }),
    )

class RideAdmin(admin.ModelAdmin):
    list_display = ('id', 'driver', 'pickup_name', 'dropoff_name', 'date', 'time', 'seats_available', 'seats_total', 'price_per_seat', 'is_recurring')
    list_filter = ('date', 'is_recurring')
    search_fields = ('pickup_name', 'dropoff_name', 'driver__username', 'vehicle_model')

class BookingAdmin(admin.ModelAdmin):
    list_display = ('id', 'ride', 'passenger', 'seats_booked', 'status', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('passenger__username', 'ride__pickup_name', 'ride__dropoff_name')

class MessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'sender', 'receiver', 'ride', 'content_snippet', 'created_at', 'is_read')
    list_filter = ('is_read', 'created_at')
    search_fields = ('sender__username', 'receiver__username', 'content')

    def content_snippet(self, obj):
        return obj.content[:50] + '...' if len(obj.content) > 50 else obj.content
    content_snippet.short_description = "Content"

class NotificationAdmin(admin.ModelAdmin):
    list_display = ('id', 'user', 'title', 'notification_type', 'is_read', 'created_at')
    list_filter = ('notification_type', 'is_read', 'created_at')
    search_fields = ('user__username', 'title', 'content')

class ReviewAdmin(admin.ModelAdmin):
    list_display = ('id', 'ride', 'reviewer', 'reviewee', 'rating', 'created_at')
    list_filter = ('rating', 'created_at')
    search_fields = ('reviewer__username', 'reviewee__username', 'comment')

@admin.action(description="Mark selected reports as resolved")
def resolve_reports(modeladmin, request, queryset):
    queryset.update(status='resolved')

class ReportAdmin(admin.ModelAdmin):
    list_display = ('id', 'reporter', 'reported_user', 'reason', 'status', 'created_at')
    list_filter = ('status', 'created_at', 'reason')
    search_fields = ('reporter__username', 'reported_user__username', 'details')
    actions = [resolve_reports]

class BlockedUserAdmin(admin.ModelAdmin):
    list_display = ('id', 'blocker', 'blocked', 'created_at')
    search_fields = ('blocker__username', 'blocked__username')

# Registering models
admin.site.register(User, CustomUserAdmin)
admin.site.register(Ride, RideAdmin)
admin.site.register(Booking, BookingAdmin)
admin.site.register(Message, MessageAdmin)
admin.site.register(Notification, NotificationAdmin)
admin.site.register(Review, ReviewAdmin)
admin.site.register(Report, ReportAdmin)
admin.site.register(BlockedUser, BlockedUserAdmin)
