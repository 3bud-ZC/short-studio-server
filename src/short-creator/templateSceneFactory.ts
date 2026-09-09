import type { BusinessTemplateId } from "./business-templates";

export type TemplateData = Record<string, string>;

export type GeneratedScene = {
  text: string;
  searchTerms?: string[];
};

function pickValue(
  templateData: TemplateData | undefined,
  key: string,
  fallback: string,
): string {
  return templateData?.[key]?.trim() || fallback;
}

function buildProductAdScenes(templateData?: TemplateData): GeneratedScene[] {
  const productName = pickValue(templateData, "productName", "This basic cotton tee");
  const benefit = pickValue(
    templateData,
    "mainBenefit",
    "comfortable everyday wear",
  );
  const offer = pickValue(templateData, "priceOrOffer", "a limited offer");
  const customer = pickValue(templateData, "targetCustomer", "young adults");
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  return [
    { text: "Need a clean everyday T-shirt that actually feels comfortable?" },
    {
      text: `${productName} is soft cotton, easy to style, and made for ${customer}.`,
    },
    {
      text: `Wear it for ${benefit} and grab it now with ${offer}.`,
    },
    { text: `Message us on ${contact} now to reserve yours.` },
  ];
}

function buildRestaurantScenes(templateData?: TemplateData): GeneratedScene[] {
  const name = pickValue(templateData, "restaurantName", "this spot");
  const meal = pickValue(templateData, "mealOrOfferName", "a signature dish");
  const price = pickValue(templateData, "priceOrDeal", "a special price");
  const location = pickValue(templateData, "location", "the city");
  const delivery = pickValue(
    templateData,
    "deliveryAvailable",
    "Delivery available",
  );
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  const deliveryLine = delivery.includes("لا")
    ? `Visit us in ${location} and grab it while it's hot.`
    : `${delivery}. We deliver across ${location}.`;

  return [
    { text: `Craving ${meal}? ${name} is serving it sizzling right now.` },
    { text: `${meal} now comes with ${price}, cooked daily for serious flavor.` },
    { text: deliveryLine },
    { text: `Message us on ${contact} today to order before the offer ends.` },
  ];
}

function buildRealEstateScenes(templateData?: TemplateData): GeneratedScene[] {
  const propertyType = pickValue(templateData, "propertyType", "apartment");
  const location = pickValue(templateData, "location", "New Cairo");
  const area = pickValue(templateData, "area", "120");
  const rooms = pickValue(templateData, "rooms", "3");
  const price = pickValue(templateData, "price", "a flexible payment plan");
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  return [
    { text: `Looking for a modern ${propertyType} in ${location}?` },
    {
      text: `${area} m² with ${rooms} bedrooms and a layout ready to move in.`,
    },
    { text: `Priced at ${price} and waiting in ${location}.` },
    { text: `Message us on ${contact} now to book a viewing.` },
  ];
}

function ensureSentence(text: string, fallback: string): string {
  const trimmed = (text || fallback).trim();
  if (!trimmed) {
    return fallback;
  }
  return /[.!?؟،]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function buildEducationalScenes(templateData?: TemplateData): GeneratedScene[] {
  const topic = pickValue(templateData, "topic", "programming basics");
  const audience = pickValue(templateData, "audience", "beginner students");
  const lesson = pickValue(
    templateData,
    "keyLesson",
    "variables store reusable information",
  );
  const teacher = pickValue(
    templateData,
    "courseOrTeacherName",
    "our coaching team",
  );
  const cta = pickValue(
    templateData,
    "callToAction",
    "Follow for more tips or message us to join the course",
  );

  return [
    {
      text: `Struggling to understand ${topic}? ${audience} ask us for this quick breakdown.`,
    },
    {
      text: `Start with ${lesson}; it keeps every concept reusable.`,
    },
    {
      text: `${teacher} teaches it this way so the next lesson actually sticks.`,
    },
    { text: ensureSentence(cta, "Follow for more tips.") },
  ];
}

function buildViralCuriosityScenes(templateData?: TemplateData): GeneratedScene[] {
  const topic = pickValue(
    templateData,
    "topic",
    "octopuses have three hearts",
  );
  const fact = pickValue(
    templateData,
    "weirdFact",
    "two pump blood to the gills and one pumps it to the body",
  );
  const twist = pickValue(
    templateData,
    "twist",
    "the main heart stops beating when it swims",
  );
  const cta = pickValue(
    templateData,
    "callToAction",
    "Follow for more strange facts",
  );

  return [
    { text: `Did you know ${topic}?` },
    { text: `${fact}.` },
    { text: `But here's the strange part: ${twist}.` },
    { text: ensureSentence(cta, "Follow for more.") },
  ];
}

function buildEventPromoScenes(templateData?: TemplateData): GeneratedScene[] {
  const eventName = pickValue(templateData, "eventName", "this event");
  const eventDate = pickValue(templateData, "eventDate", "this weekend");
  const venue = pickValue(templateData, "venue", "the main hall");
  const highlight = pickValue(
    templateData,
    "highlight",
    "a live set you will not want to miss",
  );
  const tickets = pickValue(templateData, "ticketInfo", "limited seats");
  const contact = pickValue(templateData, "contactMethod", "WhatsApp");

  return [
    { text: `${eventName} is happening ${eventDate}.` },
    { text: `Doors open at ${venue}, and it is built around ${highlight}.` },
    { text: `Entry is ${tickets}, so the room fills quickly.` },
    { text: `Book on ${contact} today before it sells out.` },
  ];
}

/* --------------------------------------------------------- V2.5.1 additions */

function buildSaasPromoScenes(templateData?: TemplateData): GeneratedScene[] {
  const product = pickValue(templateData, "productName", "this tool");
  const problem = pickValue(templateData, "problem", "answering the same questions all day");
  const benefit = pickValue(templateData, "mainBenefit", "hours back every week");
  const audience = pickValue(templateData, "targetCustomer", "small teams");
  const cta = pickValue(templateData, "callToAction", "Start free today");

  return [
    { text: ensureSentence(`Still ${problem}?`, "Still doing it the hard way?") },
    { text: `${product} handles it for ${audience}, without a new process to learn.` },
    { text: `That is ${benefit}, from the first week.` },
    { text: ensureSentence(cta, "Start free today.") },
  ];
}

function buildBusinessTipsScenes(templateData?: TemplateData): GeneratedScene[] {
  const topic = pickValue(templateData, "topic", "running a small business");
  const audience = pickValue(templateData, "audience", "owners");
  const cta = pickValue(templateData, "callToAction", "Follow for more");
  // One tip per line is what the field asks for, so that is what is honoured.
  const tips = pickValue(templateData, "tips", "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return [
    { text: `If you are one of the ${audience} figuring out ${topic}, start here.` },
    ...(tips.length > 0
      ? tips.map((tip) => ({ text: ensureSentence(tip, "") }))
      : [
          { text: "Write down the one task that eats your week." },
          { text: "Give it a fixed slot instead of a free-floating intention." },
          { text: "Review it once, at the end of the month, not every day." },
        ]),
    { text: ensureSentence(cta, "Follow for more.") },
  ];
}

function buildStoryScenes(templateData?: TemplateData): GeneratedScene[] {
  const subject = pickValue(templateData, "subject", "this");
  const message = pickValue(templateData, "message", "Small things compound.");
  const story = pickValue(templateData, "story", "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return [
    { text: `This is about ${subject}.` },
    ...(story.length > 0
      ? story.map((line) => ({ text: ensureSentence(line, "") }))
      : [
          { text: "It started the way most things start: quietly." },
          { text: "Then one decision changed what came next." },
          { text: "Looking back, it was the smallest one that mattered." },
        ]),
    { text: ensureSentence(message, "Small things compound.") },
  ];
}

function buildNewsUpdateScenes(templateData?: TemplateData): GeneratedScene[] {
  const headline = pickValue(templateData, "headline", "Something has changed");
  const details = pickValue(templateData, "details", "Here is what is different.");
  const effective = pickValue(templateData, "effectiveDate", "");
  const cta = pickValue(templateData, "callToAction", "");

  return [
    { text: ensureSentence(headline, "Something has changed.") },
    { text: ensureSentence(details, "Here is what is different.") },
    // A date and an action are only stated when they were actually supplied;
    // inventing either is the defect the invented-claim gate exists to catch.
    ...(effective ? [{ text: `This applies from ${effective}.` }] : []),
    ...(cta ? [{ text: ensureSentence(cta, "") }] : [{ text: "Nothing is needed from you." }]),
  ];
}

function buildSocialAdScenes(templateData?: TemplateData): GeneratedScene[] {
  const offer = pickValue(templateData, "offer", "this");
  const audience = pickValue(templateData, "audience", "you");
  const cta = pickValue(templateData, "callToAction", "Order now");

  return [
    { text: `If you are ${audience}, stop scrolling.` },
    { text: ensureSentence(offer, "") },
    { text: ensureSentence(cta, "Order now.") },
  ];
}

function buildMyMediaScenes(templateData?: TemplateData): GeneratedScene[] {
  const subject = pickValue(templateData, "subject", "this");
  const message = pickValue(templateData, "message", "See it for yourself.");
  const cta = pickValue(templateData, "callToAction", "Get in touch");

  return [
    { text: `This is ${subject}.` },
    { text: ensureSentence(message, "See it for yourself.") },
    { text: "Every shot here is our own." },
    { text: ensureSentence(cta, "Get in touch.") },
  ];
}

export function generateScenesForTemplate(
  templateId: BusinessTemplateId,
  templateData?: TemplateData,
): GeneratedScene[] {
  switch (templateId) {
    case "product_ad":
      return buildProductAdScenes(templateData);
    case "restaurant_offer":
      return buildRestaurantScenes(templateData);
    case "real_estate_listing":
      return buildRealEstateScenes(templateData);
    case "educational_tip":
      return buildEducationalScenes(templateData);
    case "viral_curiosity":
      return buildViralCuriosityScenes(templateData);
    case "event_promo":
      return buildEventPromoScenes(templateData);
    case "saas_promo":
      return buildSaasPromoScenes(templateData);
    case "business_tips":
      return buildBusinessTipsScenes(templateData);
    case "story_narrative":
      return buildStoryScenes(templateData);
    case "news_update":
      return buildNewsUpdateScenes(templateData);
    case "social_ad":
      return buildSocialAdScenes(templateData);
    case "my_media_showcase":
      return buildMyMediaScenes(templateData);
    default:
      return [];
  }
}
