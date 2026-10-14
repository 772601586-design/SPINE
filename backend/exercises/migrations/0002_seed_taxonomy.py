from django.db import migrations


REGIONS = [
    ("neck_shoulder", "颈肩"), ("scapular_upper_back", "肩胛及上背"),
    ("thorax_breathing", "胸廓与呼吸"), ("posterior_trunk", "背部及躯干后侧"),
    ("abdominal_lateral", "腹部及躯干侧面"), ("pelvis_gluteal", "骨盆及臀部"),
    ("hip_lower_limb", "髋与下肢"), ("whole_body", "全身协同"),
]
MUSCLES = [
    ("neck_muscles", "颈部肌群"), ("trapezius", "斜方肌"), ("serratus_anterior", "前锯肌"),
    ("rhomboids", "菱形肌"), ("respiratory_muscles", "呼吸相关肌群"),
    ("erector_spinae", "竖脊肌"), ("multifidus", "多裂肌"), ("transversus_abdominis", "腹横肌"),
    ("obliques", "腹斜肌"), ("quadratus_lumborum", "腰方肌"), ("gluteus_maximus", "臀大肌"),
    ("gluteus_medius", "臀中肌"), ("hip_flexors", "髋屈肌"), ("hamstrings", "腘绳肌"),
]
GOALS = [
    ("mobility", "活动度"), ("stability", "稳定"), ("endurance", "耐力"),
    ("breathing", "呼吸配合"), ("balance", "平衡"), ("postural_control", "姿势控制"),
    ("functional_coordination", "功能协同"),
]


def seed(apps, schema_editor):
    for name, rows in (("Region", REGIONS), ("Muscle", MUSCLES), ("Goal", GOALS)):
        model = apps.get_model("exercises", name)
        for index, (code, label) in enumerate(rows):
            model.objects.get_or_create(code=code, defaults={"name": label, "sort_order": index})


class Migration(migrations.Migration):
    dependencies = [("exercises", "0001_initial")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
