export const BUSINESS_TEMPLATE_IDS = [
  "product_ad",
  "restaurant_offer",
  "real_estate_listing",
  "educational_tip",
  "viral_curiosity",
  "event_promo",
  "saas_promo",
  "business_tips",
  "story_narrative",
  "news_update",
  "social_ad",
  "my_media_showcase",
] as const;

export type BusinessTemplateId = (typeof BUSINESS_TEMPLATE_IDS)[number];

export type BusinessTemplateFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select";

export type BusinessTemplateField = {
  key: string;
  label: string;
  type: BusinessTemplateFieldType;
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

export interface BusinessTemplate {
  id: BusinessTemplateId;
  displayName: string;
  description: string;
  targetUseCase: string;
  defaultTone: string;
  suggestedDurationSeconds: number;
  examplePrompt: string;
  pexelsSearchHints: string[];
  fallbackPexelsSearchHints: string[];
  hookStyle: string;
  ctaStyle: string;
  fields: BusinessTemplateField[];
  recommendedSceneCount?: number;
  targetDurationSeconds?: number;
  qualityChecklist?: string[];
}

const TEMPLATE_DEFINITIONS: Record<BusinessTemplateId, BusinessTemplate> = {
  product_ad: {
    id: "product_ad",
    displayName: "Product Ad",
    description:
      "Perfect for highlighting a single product with a bold hook, benefit-driven middle, and urgent CTA.",
    targetUseCase: "Retailers and D2C brands promoting a hero product",
    defaultTone: "Bold, confident, conversational Egyptian Arabic",
    suggestedDurationSeconds: 35,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook asks a direct question or highlights comfort",
      "Value line explains fabric/fit",
      "Offer mentions limited stock/price",
      "CTA points to WhatsApp or direct order",
    ],
    examplePrompt:
      "عرف جمهورك على المنتج، أبرز فائدة حقيقية، وانهِ بدعوة للشراء قبل انتهاء العرض",
    pexelsSearchHints: [
      "fashion",
      "clothing",
      "t shirt",
      "streetwear",
      "shopping",
      "retail store",
      "model clothing",
      "clothes rack",
      "cotton fabric",
      "casual outfit",
    ],
    fallbackPexelsSearchHints: [
      "fashion",
      "apparel",
      "shopping",
      "retail store",
      "clothes store",
      "streetwear",
      "model clothing",
      "cotton fabric",
      "minimal wardrobe",
    ],
    hookStyle: "Start with a dramatic question or bold stat",
    ctaStyle: "Clear price mention + urgency to DM or visit store",
    fields: [
      {
        key: "productName",
        label: "Product Name",
        type: "text",
        required: true,
        placeholder: "مثال: شنطة يد جلد طبيعي",
      },
      {
        key: "productCategory",
        label: "Product Category",
        type: "text",
        required: true,
        placeholder: "إكسسوارات، أزياء رياضية، أجهزة منزلية...",
      },
      {
        key: "mainBenefit",
        label: "Main Benefit",
        type: "textarea",
        required: true,
        helperText: "ما السبب الرئيسي لشراء المنتج الآن؟",
      },
      {
        key: "priceOrOffer",
        label: "Price or Offer",
        type: "text",
        required: true,
        placeholder: "مثال: 599 جنيه بدل 750 لمدة 48 ساعة",
      },
      {
        key: "targetCustomer",
        label: "Target Customer",
        type: "text",
        required: true,
        placeholder: "سيدات القاهرة، طلاب جامعة، أصحاب المشاريع...",
      },
      {
        key: "contactMethod",
        label: "Preferred Contact Method",
        type: "text",
        required: true,
        helperText: "اكتب طريقة التواصل: واتساب، إنستجرام، زيارة فرع...",
      },
    ],
  },
  restaurant_offer: {
    id: "restaurant_offer",
    displayName: "Restaurant Offer",
    description:
      "For cafés and restaurants teasing a seasonal menu, combo, or delivery promo.",
    targetUseCase: "Local restaurants in Cairo/Alexandria pushing dine-in or delivery",
    defaultTone: "Warm, appetizing, friendly Egyptian Arabic",
    suggestedDurationSeconds: 40,
    recommendedSceneCount: 4,
    targetDurationSeconds: 22,
    qualityChecklist: [
      "Hook mentions craving or fresh meal",
      "Offer line names the dish and deal",
      "Delivery or location convenience is stated",
      "CTA tells viewers to order or book",
      "B-roll shows appetizing food or kitchen shots",
    ],
    examplePrompt:
      "ابدأ بلقطة شهية، احكي عن مكونات مميزة، واختم بعرض محدود للزيارة أو الطلب",
    pexelsSearchHints: [
      "restaurant",
      "food",
      "grilled chicken",
      "meal",
      "dining",
      "kitchen",
      "chef cooking",
      "food delivery",
      "takeaway food",
      "cafe",
    ],
    fallbackPexelsSearchHints: [
      "restaurant",
      "food",
      "meal",
      "dining",
      "kitchen",
      "chef",
      "food delivery",
      "takeaway food",
      "cafe",
    ],
    hookStyle: "Sensory hook describing smell/texture",
    ctaStyle: "Invite viewers to book a table or order now",
    fields: [
      {
        key: "restaurantName",
        label: "Restaurant Name",
        type: "text",
        required: true,
      },
      {
        key: "mealOrOfferName",
        label: "Meal or Offer Name",
        type: "text",
        required: true,
        placeholder: "كومبو فطار، طبق توقيع الشيف...",
      },
      {
        key: "priceOrDeal",
        label: "Price or Deal",
        type: "text",
        required: true,
        helperText: "اذكر السعر أو نسبة الخصم أو كود الطلب",
      },
      {
        key: "location",
        label: "Location",
        type: "text",
        required: true,
        placeholder: "التجمع الخامس، سموحة، المعادي...",
      },
      {
        key: "deliveryAvailable",
        label: "Delivery Available?",
        type: "select",
        required: true,
        options: ["نعم - متاح دليفري", "لا - للزيارة فقط"],
      },
      {
        key: "contactMethod",
        label: "Contact or Booking",
        type: "text",
        required: true,
        helperText: "اكتب رقم، لينك طلب، أو منصّة",
      },
    ],
  },
  real_estate_listing: {
    id: "real_estate_listing",
    displayName: "Real Estate Listing",
    description:
      "Spotlights apartments or office spaces with credibility, amenities, and viewing CTA.",
    targetUseCase: "Agents advertising new listings in Egypt",
    defaultTone: "Trust-building, premium, informative",
    suggestedDurationSeconds: 45,
    recommendedSceneCount: 4,
    targetDurationSeconds: 22,
    qualityChecklist: [
      "Hook highlights the property opportunity",
      "Area/rooms/layout are mentioned",
      "Location and price/deal are clear",
      "CTA tells viewers to message/book a viewing",
      "B-roll shows apartments/interiors/buildings",
    ],
    examplePrompt:
      "قدم الموقع، أبرز أهم ميزة مع دليل اجتماعي، واختم بموعد المعاينة",
    pexelsSearchHints: [
      "apartment",
      "real estate",
      "home interior",
      "living room",
      "modern apartment",
      "building",
      "city apartment",
      "balcony",
      "bedroom",
      "house tour",
    ],
    fallbackPexelsSearchHints: [
      "apartment",
      "real estate",
      "home interior",
      "living room",
      "modern apartment",
      "building",
      "city apartment",
      "balcony",
      "bedroom",
      "house tour",
    ],
    hookStyle: "Lead with scarcity or lifestyle upgrade",
    ctaStyle: "Book a tour or call the agent",
    fields: [
      {
        key: "propertyType",
        label: "Property Type",
        type: "select",
        required: true,
        options: ["شقة", "فيلا", "مكتب", "محل", "أرض"],
      },
      {
        key: "location",
        label: "Location / Neighborhood",
        type: "text",
        required: true,
      },
      {
        key: "area",
        label: "Area (m²)",
        type: "number",
        required: true,
        helperText: "أدخل المساحة بالمتر المربع",
      },
      {
        key: "rooms",
        label: "Rooms / Layout",
        type: "number",
        required: true,
        helperText: "عدد الغرف أو التقسيم",
      },
      {
        key: "price",
        label: "Price or Installment",
        type: "text",
        required: true,
        placeholder: "سعر كاش أو قسط شهري",
      },
      {
        key: "contactMethod",
        label: "Contact Method",
        type: "text",
        required: true,
        helperText: "رقم سمسار، واتساب، أو لينك حجز",
      },
    ],
  },
  educational_tip: {
    id: "educational_tip",
    displayName: "Educational Tip",
    description:
      "Short actionable lessons for creators, tutors, or coaches who want to teach a single insight.",
    targetUseCase: "Educators and coaches sharing a quick lesson",
    defaultTone: "Friendly, helpful, confident",
    suggestedDurationSeconds: 35,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook mentions a common struggle or question",
      "Lesson explains one clear idea",
      "Example/use-case line is included",
      "CTA invites to follow/message/join",
      "Footage shows students, laptops, or classroom energy",
    ],
    examplePrompt:
      "عرّف المشكلة، اشرح فكرة واحدة ببساطة، واختم بدعوة لمتابعة الدروس أو الاشتراك",
    pexelsSearchHints: [
      "student",
      "education",
      "classroom",
      "study",
      "teacher",
      "online learning",
      "coding",
      "programming",
      "laptop study",
      "computer class",
    ],
    fallbackPexelsSearchHints: [
      "student",
      "education",
      "classroom",
      "study",
      "teacher",
      "online learning",
      "coding",
      "programming",
      "laptop study",
      "computer class",
    ],
    hookStyle: "Pose a relatable pain question",
    ctaStyle: "Encourage DM for checklist or free consult",
    fields: [
      {
        key: "topic",
        label: "Topic",
        type: "text",
        required: true,
        placeholder: "مثال: إدارة الوقت لرواد الأعمال",
      },
      {
        key: "audience",
        label: "Audience",
        type: "text",
        required: true,
        helperText: "من الشخص الذي يستفيد من النصيحة؟",
      },
      {
        key: "keyLesson",
        label: "Key Lesson",
        type: "textarea",
        required: true,
        helperText: "اكتب أهم 2-3 نقاط تريد توضيحها",
      },
      {
        key: "courseOrTeacherName",
        label: "Course or Teacher Name",
        type: "text",
        required: true,
      },
      {
        key: "callToAction",
        label: "Call To Action",
        type: "text",
        required: true,
        placeholder: "راسلنا على واتساب لتحميل الدليل",
        helperText: "مثال: تابعونا للمزيد أو راسلنا للانضمام",
      },
    ],
  },
  viral_curiosity: {
    id: "viral_curiosity",
    displayName: "Viral Curiosity Short",
    description:
      "Fast-paced format for reels highlighting surprising facts about animals, science, or hidden trivia.",
    targetUseCase: "Content creators chasing viral reach with curiosity hooks",
    defaultTone: "Playful, fast, scroll-stopping",
    suggestedDurationSeconds: 30,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Hook opens with a curiosity question or 'Did you know'",
      "Weird fact is stated clearly and simply",
      "Explanation or extra detail is easy to follow",
      "Twist or strong ending keeps attention",
      "Footage matches the topic (ocean, animals, science, nature)",
      "Captions are readable and pacing feels fast",
    ],
    examplePrompt:
      "افتتح بسؤال غريب، اذكر حقيقة مفاجئة، واختم بدعوة لمتابعة المزيد",
    pexelsSearchHints: [
      "octopus",
      "underwater",
      "ocean",
      "sea life",
      "marine animal",
      "animal",
      "nature",
      "wildlife",
      "science",
      "ocean wildlife",
    ],
    fallbackPexelsSearchHints: [
      "octopus",
      "underwater",
      "ocean",
      "sea life",
      "marine animal",
      "animal",
      "nature",
      "wildlife",
      "science",
      "ocean wildlife",
    ],
    hookStyle: "Drop a shocking stat in first sentence",
    ctaStyle: "Ask viewers to comment or try it locally",
    fields: [
      {
        key: "topic",
        label: "Topic or Business Angle",
        type: "text",
        required: true,
      },
      {
        key: "weirdFact",
        label: "Weird Fact",
        type: "textarea",
        required: true,
        helperText: "اكتب المعلومة أو المفاجأة",
      },
      {
        key: "audience",
        label: "Audience",
        type: "text",
        required: true,
      },
      {
        key: "twist",
        label: "Twist or Challenge",
        type: "text",
        required: true,
        helperText: "كيف تربط الحقيقة بتحدي أو تجربة؟",
      },
      {
        key: "callToAction",
        label: "Call To Action",
        type: "text",
        required: true,
        placeholder: "اكتب CTA يدفع للتعليق أو الزيارة",
      },
    ],
  },
  event_promo: {
    id: "event_promo",
    displayName: "Event Promo",
    description:
      "Announces a dated event: what it is, when and where, the atmosphere, and an urgent booking CTA.",
    targetUseCase: "Venues, organisers and brands promoting a dated event",
    defaultTone: "Anticipation-building, warm, urgent Egyptian Arabic",
    suggestedDurationSeconds: 25,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Opening states what the event is",
      "Date, time and venue are on screen, not only spoken",
      "Atmosphere footage shows the kind of night it will be",
      "CTA carries real urgency: limited seats or a closing date",
    ],
    examplePrompt:
      "اعلن عن الفعالية، حدد التاريخ والمكان، وأظهر الأجواء، واختم بدعوة للحجز قبل نفاد الأماكن",
    pexelsSearchHints: [
      "event stage lights",
      "conference audience",
      "festival crowd",
      "venue interior evening",
      "concert lighting",
      "people celebrating",
    ],
    fallbackPexelsSearchHints: [
      "event",
      "crowd",
      "stage",
      "celebration",
      "venue",
    ],
    hookStyle: "Name the event and the date in the first line",
    ctaStyle: "Book now, with a stated deadline or limited capacity",
    fields: [
      {
        key: "eventName",
        label: "Event Name",
        type: "text",
        required: true,
        placeholder: "مثال: ليلة الجاز في الساقية",
      },
      {
        key: "eventDate",
        label: "Date and Time",
        type: "text",
        required: true,
        placeholder: "مثال: الجمعة 12 سبتمبر - 8 مساءً",
      },
      {
        key: "venue",
        label: "Venue or Location",
        type: "text",
        required: true,
      },
      {
        key: "highlight",
        label: "Main Attraction",
        type: "textarea",
        required: true,
        helperText: "ما الذي يجعل الحضور يستحق؟",
      },
      {
        key: "ticketInfo",
        label: "Tickets or Entry",
        type: "text",
        required: true,
        placeholder: "مثال: 250 جنيه - الأماكن محدودة",
      },
      {
        key: "contactMethod",
        label: "Booking Channel",
        type: "text",
        required: true,
        placeholder: "WhatsApp / Instagram / Link",
      },
    ],
  },
  // ------------------------------------------------------- V2.5.1 additions
  // Six formats the library was missing. Each one differs from the others in
  // what it actually produces, not only in its wording: see
  // `templateProductionProfiles.ts` for the shape, length, visual strategy,
  // caption treatment and production mode each of them resolves to.
  saas_promo: {
    id: "saas_promo",
    displayName: "SaaS / AI Product Promo",
    description:
      "A short, benefit-led promo for a software or AI product: the problem, the fix, the proof, the sign-up.",
    targetUseCase: "Software and AI teams promoting a product to small businesses",
    defaultTone: "Sharp, modern, benefit-led",
    suggestedDurationSeconds: 20,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Opens with the problem the customer already has",
      "Names the product and what it actually does",
      "States one concrete benefit, not a slogan",
      "Ends with a specific next step",
    ],
    examplePrompt:
      "Open with the problem this tool removes, say plainly what it does, give one concrete benefit, and end with how to start.",
    pexelsSearchHints: [
      "laptop typing",
      "software team",
      "startup office",
      "dashboard screen",
      "remote work",
      "collaboration",
    ],
    fallbackPexelsSearchHints: ["office", "technology", "computer", "team meeting"],
    hookStyle: "Name the problem the viewer already recognises",
    ctaStyle: "One clear next step: try it, book a demo, start free",
    fields: [
      { key: "productName", label: "Product name", type: "text", required: true },
      {
        key: "problem",
        label: "Problem it removes",
        type: "textarea",
        required: true,
        helperText: "What is painful today, in the customer's words",
      },
      { key: "mainBenefit", label: "Main benefit", type: "text", required: true },
      { key: "targetCustomer", label: "Who it is for", type: "text", required: true },
      {
        key: "callToAction",
        label: "Next step",
        type: "text",
        required: true,
        placeholder: "Start free / Book a demo",
      },
    ],
  },
  business_tips: {
    id: "business_tips",
    displayName: "Business Tips",
    description:
      "A numbered list of practical tips, told as clean on-screen points rather than generic stock footage.",
    targetUseCase: "Consultants and small business owners sharing practical advice",
    defaultTone: "Direct, useful, no filler",
    suggestedDurationSeconds: 30,
    recommendedSceneCount: 5,
    targetDurationSeconds: 30,
    qualityChecklist: [
      "Opens by naming who the advice is for",
      "Each tip is one specific, actionable sentence",
      "No tip repeats another",
      "Ends by inviting a follow or a question",
    ],
    examplePrompt:
      "Name who this is for, give three specific tips they can act on today, and end by inviting a question.",
    pexelsSearchHints: ["small business", "shop owner", "planning", "notebook", "meeting"],
    fallbackPexelsSearchHints: ["business", "work", "office"],
    hookStyle: "Say exactly who the advice is for",
    ctaStyle: "Invite a follow or a question in the comments",
    fields: [
      { key: "topic", label: "Topic", type: "text", required: true },
      { key: "audience", label: "Who it is for", type: "text", required: true },
      {
        key: "tips",
        label: "The tips",
        type: "textarea",
        required: true,
        helperText: "One tip per line",
      },
      {
        key: "callToAction",
        label: "Call to action",
        type: "text",
        required: true,
      },
    ],
  },
  story_narrative: {
    id: "story_narrative",
    displayName: "Story",
    description:
      "A longer, slower piece that carries one story from its opening line to its point.",
    targetUseCase: "Brands and creators telling a story rather than making an offer",
    defaultTone: "Warm, unhurried, cinematic",
    suggestedDurationSeconds: 45,
    recommendedSceneCount: 6,
    targetDurationSeconds: 45,
    qualityChecklist: [
      "Opens on a moment, not a summary",
      "The middle changes something",
      "The point is stated once, at the end",
      "Shots are held rather than cut on every line",
    ],
    examplePrompt:
      "Open on a single moment, carry it through what changed, and land the point in one closing line.",
    pexelsSearchHints: ["sunrise", "walking", "hands", "city street", "portrait", "quiet moment"],
    fallbackPexelsSearchHints: ["people", "nature", "city"],
    hookStyle: "Open on a moment, not a summary",
    ctaStyle: "Land the point in one line; no hard sell",
    fields: [
      { key: "subject", label: "Who or what the story is about", type: "text", required: true },
      {
        key: "story",
        label: "The story",
        type: "textarea",
        required: true,
        helperText: "What happened, in the order it happened",
      },
      { key: "message", label: "The point", type: "text", required: true },
    ],
  },
  news_update: {
    id: "news_update",
    displayName: "News / Update",
    description:
      "A square, graphics-led update that states what changed, when, and what it means.",
    targetUseCase: "Announcing a change, a release or a piece of news",
    defaultTone: "Clear, factual, unhurried",
    suggestedDurationSeconds: 20,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "States what changed in the first sentence",
      "Says when it takes effect",
      "Says what the viewer should do, if anything",
      "Claims nothing that was not supplied",
    ],
    examplePrompt:
      "State what changed, when it applies, and what the viewer needs to do about it. State no figure I did not give you.",
    pexelsSearchHints: ["announcement", "city", "office", "screen", "calendar"],
    fallbackPexelsSearchHints: ["business", "technology"],
    hookStyle: "Lead with what changed",
    ctaStyle: "Say what the viewer should do, or say that nothing is needed",
    fields: [
      { key: "headline", label: "What changed", type: "text", required: true },
      { key: "details", label: "Details", type: "textarea", required: true },
      { key: "effectiveDate", label: "When it applies", type: "text", required: false },
      { key: "callToAction", label: "What to do", type: "text", required: false },
    ],
  },
  social_ad: {
    id: "social_ad",
    displayName: "Social Advertisement",
    description:
      "The shortest format: one hook, one offer, one action, built to survive a scroll.",
    targetUseCase: "Paid and organic social advertising",
    defaultTone: "Fast, direct, confident",
    suggestedDurationSeconds: 15,
    recommendedSceneCount: 3,
    targetDurationSeconds: 15,
    qualityChecklist: [
      "Hook lands in the first two seconds",
      "One offer, stated once",
      "One action, stated clearly",
      "Nothing is claimed that was not supplied",
    ],
    examplePrompt:
      "Open with a two-second hook, state the offer once, and close on one clear action.",
    pexelsSearchHints: ["shopping", "product", "lifestyle", "city", "smiling"],
    fallbackPexelsSearchHints: ["lifestyle", "people"],
    hookStyle: "Two seconds or nothing",
    ctaStyle: "One action, said once",
    fields: [
      { key: "offer", label: "The offer", type: "text", required: true },
      { key: "audience", label: "Who it is for", type: "text", required: true },
      { key: "callToAction", label: "The action", type: "text", required: true },
    ],
  },
  my_media_showcase: {
    id: "my_media_showcase",
    displayName: "My Media Showcase",
    description:
      "Built entirely from footage and photographs you upload. No stock library is contacted.",
    targetUseCase: "Showing your own work, place, product or event in your own footage",
    defaultTone: "Honest, unembellished",
    suggestedDurationSeconds: 20,
    recommendedSceneCount: 4,
    targetDurationSeconds: 20,
    qualityChecklist: [
      "Every shot is the customer's own media",
      "No stock provider is contacted",
      "Narration describes what is actually on screen",
      "Ends with one clear action",
    ],
    examplePrompt:
      "Describe what my own footage shows, in the order I selected it, and end with one clear action.",
    pexelsSearchHints: [],
    fallbackPexelsSearchHints: [],
    hookStyle: "Open on your strongest shot",
    ctaStyle: "One clear action at the end",
    fields: [
      { key: "subject", label: "What the footage shows", type: "text", required: true },
      { key: "message", label: "What you want to say about it", type: "textarea", required: true },
      { key: "callToAction", label: "Call to action", type: "text", required: true },
    ],
  },
};

export function getBusinessTemplateById(
  id: BusinessTemplateId,
): BusinessTemplate {
  return TEMPLATE_DEFINITIONS[id];
}

export function listBusinessTemplates(): BusinessTemplate[] {
  return Object.values(TEMPLATE_DEFINITIONS);
}
