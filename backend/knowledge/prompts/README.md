# 知识库提示词与内容包

这个目录是「知识库 → 精选专题」六个专题的内容生产工具链。它不产生"已审核"内容，只产生**可导入的草稿**。

```
prompts/
  00-总纲-知识库内容生成提示词.md    # 角色、硬性规则、七章节结构、YAML 字段、自检清单
  01…06-专题提示词-*.md             # 每个专题的读者、必答问题、可用来源、选题、验收标准
content/
  sources.json                      # 14 条权威来源（含 DOI/PMID/URL），全部为"未核对"状态
  topics/*.md                       # 16 篇专题稿件，人工可编辑的事实源文件
  build_package.py                  # 把 topics/*.md 打包成 articles.json + knowledge-topics.zip
  articles.json                     # 生成物：导入器接受的数组
  knowledge-topics.zip              # 生成物：含 articles.json 与 sources.json，用于批量导入
```

## 一次生成一篇新稿

1. 打开 `prompts/00-总纲`，把全文复制给模型；
2. 追加对应的 `prompts/0X-专题提示词`；
3. 填好输入变量里的 `专题 / 分类 / 主题 / 读者 / 可用来源 / 字数`；
4. 把模型输出的 YAML + 正文存成 `content/topics/NN-topic-NN.md`；
5. 跑 `python backend/knowledge/content/build_package.py`；
6. 导入：`manage.py import_knowledge 包.zip --user 编辑账号 --commit`。

## 三条不能越过的线

- **来源必须真实存在**。`sources.json` 里的每一条都附了 DOI 或 PMID，新增来源前先自己打开核对。
- **草稿就是草稿**。导入后 `review_status=draft`、`publication_status=draft`，专题页不会展示，直到独立医学审核人核验并发布。
- **不复制原文**。中文重写，不搬运译文、图片和表格；引用只用于核对事实。

## 导入后还要做什么

导入只完成"文本入库"。要真正出现在专题页，还需要：

1. 编辑在后台为每篇补 2 条以上「重要结论 → 正文位置 → 原文定位」；
2. 独立医学审核账号核对来源与逐条证据；
3. 管理员发布。

缺任何一步，专题页都会保持"内容正在编辑与医学审核中"。
