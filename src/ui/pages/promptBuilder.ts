/**
 * PROMPT BUILDER (V2.5.1)
 * -----------------------
 * Create Video used to show six worked example prompts under the prompt box -
 * half of them Arabic, half English, all six visible in both interface
 * languages. They were the single largest source of mixed-language copy in the
 * product, they filled the page with content nobody asked for, and clicking one
 * replaced whatever the customer had already typed.
 *
 * They are replaced by this: a meta-prompt the customer copies and sends to any
 * AI assistant they already use. The assistant answers with ONE finished
 * production prompt they paste back. Nothing here calls a model, nothing here
 * costs anything, and the customer keeps ownership of their idea.
 *
 * The template deliberately:
 *   - carries one obvious placeholder, so it is clear what to replace;
 *   - asks for prose, never JSON - the prompt box takes a description;
 *   - names no internal Short Studio concept (no production modes, no visual
 *     source enums, no caption style ids) so a generic assistant cannot invent
 *     settings this product would then have to ignore;
 *   - is written in the interface language, because that is the language the
 *     customer is reading and the language they will brief their assistant in.
 */

import type { UiLocale } from "../i18n";

export const PROMPT_BUILDER_PLACEHOLDER_EN = "[WRITE YOUR VIDEO IDEA HERE]";
export const PROMPT_BUILDER_PLACEHOLDER_AR = "[اكتب فكرة الفيديو هنا]";

const EN = `You are helping me write a single production brief for a short marketing video.

My idea:
${PROMPT_BUILDER_PLACEHOLDER_EN}

Write ONE finished prompt I can paste directly into a short-video production tool.

Cover, in plain prose and only where it genuinely applies to my idea:
- the subject of the video and the goal it should achieve
- who it is for
- the opening hook, in the first two seconds
- the story or message, in the order it should be told
- the tone and pace
- any fact, price, offer or detail that must be stated exactly as I gave it
- the visual direction: what should be on screen
- the closing call to action
- anything that must NOT appear

Rules:
- Reply with the finished prompt only. No preamble, no explanation, no options.
- Write it as prose, not JSON, not a list of settings, not a table.
- Do not invent a price, statistic, phone number, discount or claim I did not give you.
- Do not decide the video length, aspect ratio, captions or voice - I set those myself.
- Write it in the language I want the video narrated in.`;

const AR = `أنت تساعدني في كتابة وصف إنتاج واحد لفيديو تسويقي قصير.

فكرتي:
${PROMPT_BUILDER_PLACEHOLDER_AR}

اكتب وصفًا نهائيًا واحدًا يمكنني لصقه مباشرة في أداة إنتاج فيديوهات قصيرة.

غطِّ التالي بأسلوب سردي واضح، وفقط عندما ينطبق فعلًا على فكرتي:
- موضوع الفيديو والهدف الذي يجب أن يحققه
- الجمهور الموجَّه إليه
- الجملة الافتتاحية الجاذبة في أول ثانيتين
- القصة أو الرسالة بالترتيب الذي يجب سردها به
- النبرة والإيقاع
- أي معلومة أو سعر أو عرض أو تفصيلة يجب ذكرها كما أعطيتها لك تمامًا
- الاتجاه البصري: ما الذي يجب أن يظهر على الشاشة
- دعوة الإجراء الختامية
- أي شيء يجب ألّا يظهر

القواعد:
- أجب بالوصف النهائي فقط. بدون مقدمة أو شرح أو خيارات متعددة.
- اكتبه بأسلوب سردي، لا بصيغة JSON ولا كقائمة إعدادات ولا كجدول.
- لا تخترع سعرًا أو إحصائية أو رقم هاتف أو خصمًا أو ادعاءً لم أعطه لك.
- لا تحدد مدة الفيديو أو أبعاده أو الترجمة النصية أو الصوت، فأنا أضبطها بنفسي.
- اكتبه باللغة التي أريد أن يُروى بها الفيديو.`;

/** The meta-prompt, in the language the customer is reading the product in. */
export function promptBuilderTemplate(locale: UiLocale): string {
  return locale === "ar" ? AR : EN;
}

export function promptBuilderPlaceholder(locale: UiLocale): string {
  return locale === "ar" ? PROMPT_BUILDER_PLACEHOLDER_AR : PROMPT_BUILDER_PLACEHOLDER_EN;
}
