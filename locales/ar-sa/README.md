<div align="center"><sub>
العربية | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">الإسبانية</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">الألمانية</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">اليابانية</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">الصينية المبسطة</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">الصينية التقليدية</a> | <a href="https://github.com/cline/cline/blob/main/locales/pt-BR/README.md" target="_blank">البرتغالية</a>
</sub></div>

# Cline

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>تنزيل من متجر VS</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>طلبات الميزات</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>البدء</strong></a>
</td>
</tbody>
</table>
</div>

التقى Cline، مساعد الذكاء الاصطناعي الذي يمكنه استخدام **سطر الأوامر** و **محرر النصوص** الخاص بك.

بفضل [قدرات Claude 4 Sonnet على التعليمات البرمجية الوكيلة](https://www.anthropic.com/claude/sonnet)، يمكن لـ Cline التعامل مع مهام تطوير البرامج المعقدة خطوة بخطوة. مع الأدوات التي تسمح له بإنشاء وتعديل الملفات، واستكشاف المشاريع الكبيرة، واستخدام المتصفح، وتنفيذ أوامر الطرفية (بعد منحك الإذن)، يمكنه مساعدتك بطرق تتجاوز إكمال الكود أو الدعم الفني. يمكن لـ Cline أيضًا استخدام بروتوكول سياق النموذج (MCP) لإنشاء أدوات جديدة وتوسيع قدراته الخاصة. في حين تعمل النصوص البرمجية الآلية المستقلة تقليديًا في بيئات محاصرة، توفر هذه الإضافة واجهة رسومية لموافقة المستخدم على كل تغيير في الملف وأمر طرفية، مما يوفر طريقة آمنة وسهلة الاستخدام لاستكشاف إمكانات الذكاء الاصطناعي الوكيل.

1. أدخل مهمتك وأضف الصور لتحويل المحاكاة إلى تطبيقات وظيفية أو إصلاح الأخطاء مع لقطات الشاشة.
2. يبدأ Cline بتحليل هيكل الملفات الخاصة بك وشجرة التعريف المصدرية، وإجراء عمليات بحث regex، وقراءة الملفات ذات الصلة للاطلاع على المشاريع الحالية. من خلال إدارة المعلومات التي يتم إضافتها إلى السياق بعناية، يمكن لـ Cline تقديم مساعدة قيمة حتى للمشاريع الكبيرة والمعقدة دون إرهاق نافذة السياق.
3. بمجرد حصول Cline على المعلومات التي يحتاجها، يمكنه:
    - إنشاء وتعديل الملفات + مراقبة أخطاء Linter/Compiler أثناء السير، مما يسمح له بإصلاح المشكلات مثل الواردات المفقودة وأخطاء البناء النحوي بمفرده.
    - تنفيذ الأوامر مباشرة في الطرفية الخاصة بك ومراقبة إخراجها أثناء العمل، مما يسمح له على سبيل المثال بالاستجابة لمشكلات خادم التطوير بعد تعديل ملف.
    - بالنسبة لمهام تطوير الويب، يمكن لـ Cline إطلاق الموقع في متصفح بلا رأس، والنقر، وكتابة النص، والتمرير، والتقاط لقطات الشاشة + سجلات وحدة التحكم، مما يسمح له بإصلاح أخطاء وقت التشغيل والأخطاء البصرية.
4. عند اكتمال المهمة، سيقدم Cline النتيجة لك مع أمر طرفية مثل `open -a "Google Chrome" index.html`، والذي تقوم بتشغيله بنقرة زر.

> [!TIP]
> استخدم اختصار `CMD/CTRL + Shift + P` لفتح لوحة الأوامر واكتب "Cline: Open In New Tab" لفتح الإضافة كعلامة تبويب في محرر النصوص الخاص بك. يتيح لك هذا استخدام Cline جنبًا إلى جنب مع مستكشف الملفات الخاص بك، ورؤية كيف يغير مساحة العمل الخاصة بك بوضوح أكبر.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### استخدم أي واجهة برمجة تطبيقات ونموذج

يدعم Cline مقدمي واجهات برمجة التطبيقات مثل OpenRouter و Anthropic و OpenAI و Google Gemini و AWS Bedrock و Azure و GCP Vertex. يمكنك أيضًا تكوين أي واجهة برمجة تطبيقات متوافقة مع OpenAI، أو استخدام نموذج محلي من خلال LM Studio/Ollama. إذا كنت تستخدم OpenRouter، فستقوم الإضافة بجلب قائمة النماذج الأحدث الخاصة بهم، مما يسمح لك باستخدام أحدث النماذج بمجرد توفرها.

تتتبع الإضافة أيضًا إجمالي الرموز والاستخدام الخاص بواجهة برمجة التطبيقات لدورة المهمة بأكملها وطلبات فردية، مما يبقيك على اطلاع بالإنفاق في كل خطوة.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### تشغيل الأوامر في الطرفية

بفضل [تحديثات تكامل الشل الجديدة في VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)، يمكن لـ Cline تنفيذ الأوامر مباشرة في الطرفية الخاصة بك وتلقي الإخراج. يسمح له هذا بأداء مجموعة واسعة من المهام، من تثبيت الحزم وتشغيل سكربتات البناء إلى نشر التطبيقات، وإدارة قواعد البيانات، وتنفيذ الاختبارات، وذلك بالتكيف مع بيئة التطوير الخاصة بك وسلسلة الأدوات للقيام بالعمل على النحو الصحيح.

بالنسبة للعمليات الطويلة المدى مثل خوادم التطوير، استخدم زر "المتابعة أثناء التشغيل" للسماح لـ Cline بالاستمرار في المهمة بينما يعمل الأمر في الخلفية. أثناء عمل Cline، سيتم إخباره بأي إخراج طرفية جديد على الطريق، مما يسمح له بالاستجابة للمشكلات التي قد تنشأ، مثل أخطاء وقت الإنشاء عند تعديل الملفات.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### إنشاء وتعديل الملفات

يمكن لـ Cline إنشاء وتعديل الملفات مباشرة في محرر النصوص الخاص بك، وعرض الاختلافات. يمكنك تعديل أو إلغاء تغييرات Cline مباشرة في محرر الاختلافات، أو تقديم ملاحظات في الدردشة حتى تكون راضيًا عن النتيجة. يراقب Cline أيضًا أخطاء Linter/Compiler (الواردات المفقودة، أخطاء البناء النحوي، إلخ) حتى يتمكن من إصلاح المشكلات التي تنشأ أثناء السير بمفرده.

يتم تسجيل جميع التغييرات التي أجراها Cline في جدول زمني للملف، مما يوفر طريقة سهلة لتتبع وإلغاء التعديلات إذا لزم الأمر.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### استخدم المتصفح

مع قدرة [استخدام الكمبيوتر](https://www.anthropic.com/news/3-5-models-and-computer-use) الجديدة لـ Claude 4 Sonnet، يمكن لـ Cline إطلاق متصفح، والنقر على العناصر، وكتابة النص، والتمرير، والتقاط لقطات الشاشة وسجلات وحدة التحكم في كل خطوة. يسمح له هذا بالتصحيح التفاعلي، واختبار نهاية إلى نهاية، وحتى الاستخدام العام للويب! يمنحه هذا الاستقلالية لإصلاح الأخطاء البصرية وأخطاء وقت التشغيل دون الحاجة إلى نسخ ولصق سجلات الأخطاء بنفسك.

حاول طلب من Cline "اختبار التطبيق"، وشاهده يشغل أمرًا مثل `npm run dev`، ويطلق خادم التطوير المحلي في متصفح، ويجري سلسلة من الاختبارات للتأكد من أن كل شيء يعمل. [شاهد عرضًا توضيحيًا هنا.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "إضافة أداة التي..."

شكراً لـ [بروتوكول سياق النموذج](https://github.com/modelcontextprotocol)، يمكن لـ Cline توسيع قدراته من خلال الأدوات المخصصة. بينما يمكنك استخدام [الخوادم التي أنشأها المجتمع](https://github.com/modelcontextprotocol/servers)، يمكن لـ Cline بدلاً من ذلك إنشاء أدوات وتثبيتها مصممة خصيصًا لتناسب سير عملك. ما عليك سوى أن تطلب من Cline "إضافة أداة"، وسيتولى كل شيء، من إنشاء خادم MCP جديد إلى تثبيته في الامتداد. تصبح هذه الأدوات المخصصة بعد ذلك جزءًا من مجموعة أدوات Cline، جاهزة للاستخدام في المهام المستقبلية.

- **"أضف أداة تجلب تذاكر Jira"**: استرجع تذاكر AC وقم بتشغيل Cline  
- **"أضف أداة تدير AWS EC2s"**: تحقق من مقاييس الخادم وقم بتوسيع أو تقليص عدد الحالات  
- **"أضف أداة تجلب أحدث حوادث PagerDuty"**: استرجع التفاصيل واطلب من Cline إصلاح الأخطاء  

<!-- بكسل شفاف لإنشاء فاصل سطر بعد الصورة العائمة -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### إضافة السياق

**`@url`**: الصق رابط URL ليقوم الامتداد بجلبه وتحويله إلى Markdown، مفيد عندما تريد تزويد Cline بأحدث الوثائق  

**`@problems`**: أضف أخطاء وتحذيرات بيئة العمل ('لوحة المشكلات') ليتمكن Cline من إصلاحها  

**`@file`**: يضيف محتويات ملف حتى لا تضطر إلى إهدار طلبات API بالموافقة على قراءة الملف (+ البحث في الملفات)  

**`@folder`**: يضيف جميع ملفات المجلد دفعة واحدة لتسريع سير العمل بشكل أكبر  

<!-- بكسل شفاف لإنشاء فاصل سطر بعد الصورة العائمة -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### نقاط التحقق: المقارنة والاستعادة

أثناء عمل Cline على مهمة، يأخذ الامتداد لقطة من بيئة العمل في كل خطوة. يمكنك استخدام زر "Compare" لرؤية الفرق بين اللقطة وبيئة العمل الحالية، وزر "Restore" للعودة إلى تلك النقطة.

على سبيل المثال، عند العمل مع خادم ويب محلي، يمكنك استخدام "استعادة بيئة العمل فقط" لاختبار إصدارات مختلفة من تطبيقك بسرعة، ثم استخدام "استعادة المهمة وبيئة العمل" عندما تجد الإصدار الذي تريد المتابعة منه. يتيح لك ذلك استكشاف أساليب مختلفة بأمان دون فقدان التقدم.

<!-- بكسل شفاف لإنشاء فاصل سطر بعد الصورة العائمة -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## المساهمة

للمساهمة في المشروع، ابدأ بـ [دليل المساهمة](CONTRIBUTING.md) لتعلم الأساسيات. يمكنك أيضًا الانضمام إلى [خادم Discord](https://discord.gg/cline) للدردشة مع المساهمين الآخرين في قناة `#contributors`. إذا كنت تبحث عن عمل بدوام كامل، تحقق من الوظائف المتاحة على [صفحة التوظيف](https://cline.bot/join-us)!  

<details>
<summary>تعليمات التطوير المحلي</summary>

1. استنساخ المستودع _(يتطلب [git-lfs](https://git-lfs.com/))_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. افتح المشروع في VSCode:
    ```bash
    code cline
    ```
3. قم بتثبيت التبعيات اللازمة للامتداد وواجهة الويب:
    ```bash
    npm run install:all
    ```
4. قم بالتشغيل بالضغط على `F5` (أو من `Run` -> `Start Debugging`) لفتح نافذة VSCode جديدة مع تحميل الامتداد. (قد تحتاج إلى تثبيت [إضافة esbuild problem matchers](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) إذا واجهت مشكلات في بناء المشروع.)

</details>

<details>
<summary>إنشاء طلب سحب (Pull Request)</summary>

1. قبل إنشاء PR، قم بإنشاء إدخال للتغييرات:
    ```bash
    npm run changeset
    ```
   سيطلب منك تحديد:
   - نوع التغيير (رئيسي، ثانوي، إصلاح)
     - `رئيسي` → تغييرات غير متوافقة (1.0.0 → 2.0.0)
     - `ثانوي` → ميزات جديدة (1.0.0 → 1.1.0)
     - `إصلاح` → إصلاحات للأخطاء (1.0.0 → 1.0.1)
   - وصف التغييرات التي قمت بها  

2. قم بحفظ التغييرات وملف `.changeset` الذي تم إنشاؤه  

3. ادفع فرعك وأنشئ PR على GitHub. سيقوم CI بـ:
   - تشغيل الاختبارات والفحوصات  
   - سيقوم Changesetbot بإنشاء تعليق يوضح تأثير الإصدار  
   - عند الدمج مع الفرع الرئيسي، سيقوم Changesetbot بإنشاء PR لحزم الإصدار  
   - عند دمج PR لحزم الإصدار، سيتم نشر إصدار جديد  

</details>

## الرخصة

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)