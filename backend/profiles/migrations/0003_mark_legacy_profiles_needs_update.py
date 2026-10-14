from django.db import migrations


def mark_legacy_profiles_needs_update(apps, schema_editor):
    Profile = apps.get_model("profiles", "Profile")
    Profile.objects.filter(completed_at__isnull=True).update(onboarding_status="needs_update")


class Migration(migrations.Migration):
    dependencies = [
        ("profiles", "0002_profile_completed_at_profile_completed_revision_and_more"),
        ("medical", "0002_medicalattachment_owner_confirmed_xray_and_more"),
    ]

    operations = [
        migrations.RunPython(mark_legacy_profiles_needs_update, migrations.RunPython.noop),
    ]
