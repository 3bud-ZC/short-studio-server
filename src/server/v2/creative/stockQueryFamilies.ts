/**
 * STOCK QUERY FAMILY ENGINE
 * -------------------------
 * One scene intent should produce several *different ways of showing it*, not
 * one literal restatement of the sentence.
 *
 * Before F2.1 a scene reached the stock providers with whatever `searchTerms`
 * the planner emitted - usually one near-transliteration of the narration, with
 * a fixed joker list ("nature", "globe", "space", "ocean") behind it. When the
 * literal phrase returned nothing the production fell straight through to
 * footage of the ocean, which is why unrelated clips appeared in business ads.
 *
 * A query *family* is an angle on the same intent: the object itself, the action
 * around it, the environment it lives in, the audience using it, and an abstract
 * support shot. Asking each family separately gives the selector genuinely
 * different candidates to score instead of eighty near-identical results from
 * one phrase.
 *
 * Everything here is deterministic and local. The narration may be Arabic; the
 * providers are queried in English, so concepts are mapped through a bilingual
 * lexicon rather than machine-translated at render time.
 */

export type QueryFamilyId =
  /** The thing being sold or discussed. */
  | "subject"
  /** The subject being used, made or delivered. */
  | "action"
  /** Where it happens. */
  | "environment"
  /** The person it is for. */
  | "audience"
  /** Texture, material or mood that supports a cut without competing with it. */
  | "support"
  /** Sector framing, used when the topic names an industry. */
  | "industry"
  /** Deliberately broad. Only emitted as a last resort, and labelled as such. */
  | "fallback";

export type StockQuery = {
  query: string;
  family: QueryFamilyId;
  /** Why this angle was generated. Persisted so a poor clip can be explained. */
  rationale: string;
  /** True for deliberately broad queries such as "business" or "technology". */
  generic: boolean;
};

export type QueryFamilyResult = {
  queries: StockQuery[];
  families: QueryFamilyId[];
  /** True when nothing but broad terms could be produced. */
  genericOnly: boolean;
  /** Concepts recognised in the narration, for auditing. */
  matchedConcepts: string[];
};

export type QueryFamilyInput = {
  narration: string;
  onScreenText?: string;
  /** Scene index in the production, used for angle diversification. */
  sceneIndex?: number;
  /** Scene role from the production spec: hook, problem, solution, cta. */
  purpose?: string;
  /** Media-intelligence visual intent, when one was resolved. */
  visualIntent?: string;
  /** Shot-level intent from the edit decision list. */
  shotIntent?: string;
  /** Topic or sector supplied by the template or the brief. */
  industryHint?: string;
  /** Creative mood, e.g. energetic or calm. */
  mood?: string;
  /** Terms the planner already produced; kept and de-duplicated, never discarded. */
  providedTerms?: string[];
  orientation?: "portrait" | "landscape";
  maxQueries?: number;
};

/**
 * A concept the engine can actually picture.
 *
 * `match` covers Arabic (including Egyptian colloquial) and English, because the
 * primary market writes scripts in Arabic while the providers index English.
 */
type Concept = {
  id: string;
  match: RegExp;
  subject: string[];
  action?: string[];
  environment?: string[];
  audience?: string[];
  support?: string[];
  industry?: string;
};

const CONCEPTS: Concept[] = [
  {
    id: "website",
    match: /موقع|مواقع|لاندينج|صفحة هبوط|ويب|website|web ?site|landing page|webpage/i,
    subject: ["modern website laptop screen", "website homepage design screen"],
    action: ["person browsing website laptop", "scrolling website on screen"],
    environment: ["creative agency desk laptop", "designer workspace monitor"],
    audience: ["small business owner using laptop", "entrepreneur laptop cafe"],
    support: ["clean desk minimal workspace", "soft light office desk"],
    industry: "digital agency",
  },
  {
    id: "mobile_app",
    match: /تطبيق|ابليكيشن|أبليكيشن|موبايل|هاتف|application\b|mobile app|smartphone|phone app/i,
    subject: ["smartphone app interface close up", "mobile phone screen in hand"],
    action: ["person using smartphone app", "hands tapping phone screen"],
    environment: ["city street using phone", "cafe table smartphone"],
    audience: ["young customer smartphone", "woman using phone outdoors"],
    support: ["phone on desk minimal", "blurred city lights bokeh"],
    industry: "mobile technology",
  },
  {
    id: "online_store",
    match: /متجر|متجرك|اونلاين|أونلاين|تسوق|شراء|online store|ecommerce|e-commerce|shop online|checkout/i,
    subject: ["online store product page screen", "ecommerce checkout on phone"],
    action: ["customer ordering online phone", "packing online order box"],
    environment: ["small warehouse shipping boxes", "retail counter packaging"],
    audience: ["happy customer receiving parcel", "shopper browsing phone"],
    support: ["cardboard boxes stack", "shopping bags on table"],
    industry: "retail ecommerce",
  },
  {
    id: "coffee",
    match: /قهوة|كافيه|بن|كوفي|coffee|cafe|barista|espresso|latte|roast/i,
    subject: ["barista espresso close up", "fresh roasted coffee beans", "coffee bag packaging"],
    action: ["barista pouring latte", "coffee beans grinding", "espresso machine extraction"],
    environment: ["modern cafe counter", "warm cafe interior"],
    audience: ["person enjoying morning coffee", "friends drinking coffee cafe"],
    support: ["coffee cup steam close up", "coffee delivery package"],
    industry: "coffee cafe",
  },
  {
    id: "restaurant",
    match: /مطعم|أكل|طعام|وجبة|بيتزا|برجر|مشويات|restaurant|food|meal|pizza|burger|dish/i,
    subject: ["signature dish close up plating", "hot food served on plate"],
    action: ["chef cooking in kitchen", "pouring sauce over dish"],
    environment: ["cozy restaurant interior evening", "busy restaurant kitchen"],
    audience: ["friends eating together restaurant", "customer enjoying meal"],
    support: ["steam rising from food", "ingredients on wooden board"],
    industry: "restaurant hospitality",
  },
  {
    id: "real_estate",
    match: /شقة|فيلا|عقار|عقارات|وحدة سكنية|كمبوند|apartment|villa|property|real estate|compound|listing/i,
    subject: ["modern apartment living room", "villa exterior daylight"],
    action: ["agent showing apartment to couple", "opening door to new home"],
    environment: ["residential compound aerial", "quiet neighbourhood street"],
    audience: ["couple viewing new home", "family moving into apartment"],
    support: ["house keys on table", "architectural model close up"],
    industry: "real estate",
  },
  {
    id: "fashion",
    match: /ملابس|تيشيرت|قميص|فستان|موضة|أزياء|clothing|t ?shirt|shirt|dress|fashion|apparel|outfit/i,
    subject: ["folded cotton t shirt close up", "clothing rack in boutique"],
    action: ["model adjusting shirt", "hands folding clothes"],
    environment: ["minimal clothing boutique interior", "fashion studio white wall"],
    audience: ["young adult wearing casual outfit", "customer trying clothes"],
    support: ["cotton fabric texture macro", "neutral fabric folds"],
    industry: "fashion retail",
  },
  {
    id: "fitness",
    match: /جيم|رياضة|تمرين|لياقة|gym|fitness|workout|training|exercise/i,
    subject: ["gym equipment close up", "dumbbells on rack"],
    action: ["person training in gym", "running on treadmill"],
    environment: ["modern gym interior", "outdoor running track morning"],
    audience: ["athlete resting after workout", "trainer coaching client"],
    support: ["sweat towel and water bottle", "chalk dust slow motion"],
    industry: "fitness wellness",
  },
  {
    id: "education",
    match: /تعليم|كورس|دورة|درس|طالب|مدرس|شرح|education|course|lesson|student|teacher|learn|tutorial/i,
    subject: ["student taking notes notebook", "online course on laptop screen"],
    action: ["teacher explaining at whiteboard", "student studying at desk"],
    environment: ["bright classroom interior", "library study space"],
    audience: ["young students in classroom", "adult learner at home desk"],
    support: ["stack of books close up", "pen writing on paper macro"],
    industry: "education",
  },
  {
    id: "healthcare",
    match: /عيادة|دكتور|طبيب|صحة|علاج|clinic|doctor|health|medical|treatment|dental/i,
    subject: ["modern clinic reception", "medical equipment close up"],
    action: ["doctor consulting patient", "nurse preparing treatment"],
    environment: ["clean clinic interior", "hospital corridor daylight"],
    audience: ["patient smiling after treatment", "family visiting clinic"],
    support: ["stethoscope on desk", "soft white medical interior"],
    industry: "healthcare",
  },
  {
    id: "event",
    match: /حفلة|حفل|فعالية|مؤتمر|معرض|افتتاح|event|conference|festival|concert|expo|opening night/i,
    subject: ["event stage lights crowd", "conference hall audience"],
    action: ["crowd cheering at event", "speaker presenting on stage"],
    environment: ["venue exterior evening lights", "exhibition hall wide"],
    audience: ["friends enjoying festival", "attendees networking"],
    support: ["stage lighting bokeh", "confetti slow motion"],
    industry: "events",
  },
  {
    id: "logistics",
    match: /شحن|توصيل|دليفري|طلبات|delivery|shipping|logistics|courier|fleet/i,
    subject: ["delivery parcel in hands", "courier scanning package"],
    action: ["courier delivering to door", "loading van with boxes"],
    environment: ["city street delivery scooter", "warehouse loading bay"],
    audience: ["customer receiving delivery", "shop owner handing parcel"],
    support: ["stacked parcels close up", "delivery route map screen"],
    industry: "logistics",
  },
  {
    id: "finance",
    match: /فلوس|سعر|دفع|تمويل|بنك|استثمار|payment|price|finance|bank|invest|budget/i,
    subject: ["payment terminal card tap", "financial dashboard on screen"],
    action: ["person paying by phone", "counting and planning budget"],
    environment: ["modern office meeting room", "bank interior daylight"],
    audience: ["business owner reviewing numbers", "couple planning finances"],
    support: ["calculator and documents", "rising chart on screen"],
    industry: "finance",
  },
  {
    id: "data_backup",
    // Arabic alternatives are written without an assumed "ال" (definite
    // article) prefix on the second word - "النسخ الاحتياطي" ("the backup")
    // and "نسخة احتياطية" ("a backup copy") are both extremely common real
    // phrasings and neither literal spelling is a substring of the other,
    // so both must be listed explicitly. `back(?:s|ing|ed)?[\s-]?up`
    // (not just literal "back up") is needed because natural narration says
    // "backing up your files", not "back up your files" - a literal-only
    // match on "back up" missed this proof's own real English scene 2.
    match: /النسخ الاحتياطي|نسخة احتياطية|نسخ احتياطي|ملفات|فقدان البيانات|استرجاع|تخزين سحابي|back(?:s|ing|ed)?[\s-]?up|\bfiles\b|data loss|restore files|cloud storage|external drive|hard drive/i,
    subject: ["laptop typing files close up", "external hard drive on desk"],
    action: ["saving files to external drive", "syncing files to cloud storage"],
    environment: ["home office desk laptop", "small business office desk"],
    audience: ["small business owner using laptop", "freelancer working on laptop"],
    support: ["memory cards and storage devices", "external drive close up"],
    industry: "technology software",
  },
  {
    id: "team_service",
    match: /فريق|خدمة|دعم|شركة|عملاء|team|service|support|company|customer|agency/i,
    subject: ["support agent with headset", "team meeting around table"],
    action: ["colleagues discussing project", "handshake after agreement"],
    environment: ["bright modern office", "co-working space daylight"],
    audience: ["happy client in meeting", "small business team"],
    support: ["notebook and coffee on desk", "office window natural light"],
    industry: "professional services",
  },
];

/** Broad terms that are acceptable only when nothing specific was recognised. */
const GENERIC_FALLBACKS = [
  "business",
  "technology",
  "success",
  "computer",
  "office",
  "people",
];

/**
 * Bare mood/style/quality words that describe HOW a shot looks, never WHAT
 * it is of - never acceptable as a standalone, ungrounded query on their
 * own (section 11/15 of the Revideo real-content proof review: a bare
 * "cinematic" query returned an unrelated behind-the-scenes filmmaking clip
 * for a small-business file-backup scene). Combined into a longer,
 * scene-grounded phrase (e.g. "laptop typing files cinematic") these words
 * are fine as framing flavor - it is only the BARE, standalone form that is
 * rejected here.
 */
const BANNED_STANDALONE_TERMS = new Set([
  "cinematic",
  "professional",
  "quality",
  "business",
  "technology",
  "modern",
  "lifestyle",
  "success",
]);

/** True when `query`, trimmed and lowercased, is EXACTLY a banned bare mood/style word with no other grounding. */
export function isGenericStandaloneQuery(query: string): boolean {
  return BANNED_STANDALONE_TERMS.has(query.trim().toLowerCase());
}

/**
 * Angle words added to a subject query so two families never return the same
 * eighty results. Chosen by shot intent, because a hook and a CTA want a
 * different framing of the same object.
 */
const SHOT_FRAMING: Record<string, string> = {
  hook: "close up",
  problem: "wide",
  contrast_before: "moody",
  contrast_after: "bright",
  solution: "medium shot",
  proof: "over the shoulder",
  detail: "macro detail",
  cta: "smiling to camera",
};

const MOOD_WORDS: Record<string, string> = {
  energetic: "vibrant",
  balanced: "natural light",
  calm: "soft light",
  premium: "cinematic",
};

function normalize(value: string): string {
  return (value || "")
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/ـ/g, "")
    .trim();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

/** Deterministic rotation so consecutive scenes do not ask for identical clips. */
function pick(list: string[] | undefined, offset: number): string | null {
  if (!list || list.length === 0) return null;
  return list[Math.abs(offset) % list.length];
}

export function matchConcepts(text: string): Concept[] {
  const haystack = normalize(text);
  return CONCEPTS.filter((concept) => concept.match.test(haystack));
}

/**
 * Builds the query families for one scene.
 *
 * The result is ordered by how specific each query is, so the provider router
 * spends its first request on the most meaningful angle and only reaches a
 * broad term when the specific ones genuinely returned nothing.
 */
export function buildStockQueryFamilies(input: QueryFamilyInput): QueryFamilyResult {
  const maxQueries = Math.max(3, Math.min(input.maxQueries ?? 8, 12));
  const text = [input.narration, input.onScreenText, input.industryHint]
    .filter(Boolean)
    .join(" ");
  const concepts = matchConcepts(text);
  const framing = SHOT_FRAMING[String(input.shotIntent || input.purpose || "").toLowerCase()] || "";
  const moodWord = MOOD_WORDS[String(input.mood || "").toLowerCase()] || "";

  // The rotation offset makes each scene of a production ask a different member
  // of the same family, rather than every scene asking for the first entry.
  //
  // This must increment by exactly 1 per scene, not a fixed step like 3: most
  // rotation lists in this lexicon (see `subject`/`support` above) have
  // exactly 3 entries, and `pick()` selects via `rotation % list.length`. A
  // step of 3 is congruent to 0 mod 3, so scene 0 and scene 1 landed on the
  // identical index for any 3-entry list (e.g. "coffee".subject) - the
  // rotation silently did nothing for the most common list length. A step of
  // 1 guarantees adjacent scenes differ for every list length greater than 1.
  const sceneIdx = input.sceneIndex ?? 0;
  const offset = concepts.length + text.length + sceneIdx;

  const queries: StockQuery[] = [];
  const addQuery = (
    value: string | null,
    family: QueryFamilyId,
    rationale: string,
    generic = false,
  ) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (queries.some((existing) => existing.query.toLowerCase() === trimmed.toLowerCase())) return;
    queries.push({ query: trimmed, family, rationale, generic });
  };

  concepts.forEach((concept, conceptIndex) => {
    const rotation = offset + conceptIndex;
    const subject = pick(concept.subject, rotation);
    // The most specific angle also carries the shot framing, because that is the
    // query whose result is most likely to be the shot actually used.
    addQuery(
      subject && framing ? `${subject} ${framing}` : subject,
      "subject",
      `subject of "${concept.id}"${framing ? ` framed as ${framing}` : ""}`,
    );
    addQuery(pick(concept.action, rotation), "action", `action around "${concept.id}"`);
    addQuery(
      pick(concept.environment, rotation),
      "environment",
      `environment for "${concept.id}"`,
    );
    addQuery(pick(concept.audience, rotation), "audience", `audience for "${concept.id}"`);
    const support = pick(concept.support, rotation);
    addQuery(
      support && moodWord ? `${support} ${moodWord}` : support,
      "support",
      `supporting texture for "${concept.id}"`,
    );
    if (concept.industry) {
      addQuery(concept.industry, "industry", `sector framing for "${concept.id}"`);
    }
  });

  // Planner-supplied terms are kept: they may carry brief-specific vocabulary the
  // lexicon cannot know. They sit after the family queries rather than ahead of
  // them, because a literal sentence is the weakest of the angles. A bare
  // mood/style word (see isGenericStandaloneQuery) is dropped rather than
  // kept - it describes HOW a shot looks, never WHAT it is of, and an
  // upstream bug (a since-fixed `enrichSearchTerms` default) once let one
  // reach here as a "planner-supplied" term and return an unrelated clip.
  unique(input.providedTerms || []).forEach((term) => {
    if (isGenericStandaloneQuery(term)) return;
    addQuery(term, concepts.length > 0 ? "support" : "subject", "term supplied by the planner");
  });

  const specificCount = queries.filter((entry) => !entry.generic).length;
  if (specificCount === 0) {
    // Nothing specific was recognised. Broad terms are emitted so the render
    // still completes, and each one is labelled `generic: true` so the metadata
    // shows the production fell back rather than chose this.
    const industryWord = input.industryHint?.trim();
    if (industryWord) {
      addQuery(industryWord, "industry", "industry hint used as the only specific signal");
    }
    GENERIC_FALLBACKS.forEach((term) => {
      addQuery(term, "fallback", "no concept recognised in the narration", true);
    });
  }

  const limited = queries.slice(0, maxQueries);
  return {
    queries: limited,
    families: unique(limited.map((entry) => entry.family)) as QueryFamilyId[],
    genericOnly: limited.every((entry) => entry.generic),
    matchedConcepts: concepts.map((concept) => concept.id),
  };
}

/** The plain search-term list the existing stock clients expect. */
export function queryFamilyTerms(result: QueryFamilyResult): string[] {
  return result.queries.map((entry) => entry.query);
}
