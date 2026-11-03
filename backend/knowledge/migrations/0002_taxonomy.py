from django.db import migrations


def seed(apps, schema_editor):
    Category = apps.get_model('knowledge', 'Category')
    Topic = apps.get_model('knowledge', 'Topic')
    Tag = apps.get_model('knowledge', 'Tag')
    categories = [
        ('discovery', '刚发现侧弯', '身体不对称、初次就诊、侧弯类型与常见误区'),
        ('results', '看懂检查结果', 'Cobb 角、影像检查、骨成熟度与复查报告'),
        ('treatment', '正在接受治疗', '观察、支具、PSSE、Schroth 与手术评估'),
        ('daily', '每天怎么生活', '运动、学校、睡眠、饮食与支具穿衣'),
        ('growth', '情绪与成长', '身体形象、焦虑、同伴关系与家长沟通'),
        ('followup', '长期康复与随访', '复查计划、停止支具、成年随访与历史档案'),
    ]
    for order, (pk, name, description) in enumerate(categories):
        Category.objects.get_or_create(pk=pk, defaults={'name': name, 'description': description, 'order': order})
    for order, (pk, name, color) in enumerate([
        ('new-diagnosis', '新确诊指南', '#6F8D86'), ('imaging', '影像检查', '#6E8499'),
        ('brace', '支具治疗', '#A18B72'), ('schroth', 'Schroth 训练', '#7E8C73'),
        ('daily-life', '日常生活', '#AA8B88'), ('mental-growth', '心理成长', '#90849C'),
    ]):
        Topic.objects.get_or_create(pk=pk, defaults={'name': name, 'color': color, 'order': order})
    for name, synonyms in [('Cobb角', ['侧弯度数', 'Cobb 角', 'cobb']), ('Schroth', ['施罗斯']), ('支具', ['矫形器']), ('PSSE', ['侧弯特异性运动'])]:
        Tag.objects.get_or_create(name=name, defaults={'synonyms': synonyms})


class Migration(migrations.Migration):
    dependencies = [('knowledge', '0001_initial')]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
