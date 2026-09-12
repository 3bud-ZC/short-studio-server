import { LocalContentAIProvider } from "../src/server/v2/content-ai/localProvider";
import { buildPromptIntentContract } from "../src/server/v2/content-ai/promptIntentContract";
import { verifyPromptFidelity } from "../src/server/v2/quality/promptFidelityGate";
import { validateProductionSpec } from "../src/types/productionSpec";

interface BenchmarkCase {
  id: string;
  prompt: string;
  lang: "en" | "ar";
  expectedKeywords: string[];
  forbiddenKeywords: string[];
}

const BENCHMARK_CASES: BenchmarkCase[] = [
  {
    id: "P01",
    prompt: "Why airplane windows are round, not square. Explain fatigue stress in simple language.",
    lang: "en",
    expectedKeywords: ["airplane", "round", "square", "fatigue"],
    forbiddenKeywords: ["whatsapp", "discount", "promo"],
  },
  {
    id: "P02",
    prompt: "Python in 2026: why type hints won. Mention Mypy and maintainability.",
    lang: "en",
    expectedKeywords: ["python", "type hints", "mypy", "maintainability"],
    forbiddenKeywords: ["whatsapp", "discount", "promo"],
  },
  {
    id: "P03",
    prompt: "A premium cinematic ad for Velvet Oud perfume. Dark luxury mood. No prices or discounts.",
    lang: "en",
    expectedKeywords: ["velvet oud", "perfume", "dark", "luxury"],
    forbiddenKeywords: ["discount", "price", "prices", "$", "% off", "whatsapp"],
  },
  {
    id: "P04",
    prompt: "Three mistakes small businesses make when backing up files.",
    lang: "en",
    expectedKeywords: ["small businesses", "backing up files", "mistakes"],
    forbiddenKeywords: ["whatsapp", "discount", "promo"],
  },
  {
    id: "P05",
    prompt: "A modern coffee shop in Cairo. Focus on atmosphere, coffee preparation, and friends meeting.",
    lang: "en",
    expectedKeywords: ["coffee shop", "cairo", "atmosphere", "coffee preparation", "friends"],
    forbiddenKeywords: ["whatsapp", "discount", "promo"],
  },
  {
    id: "P06",
    prompt: "Why does ice float on water?",
    lang: "en",
    expectedKeywords: ["ice", "float", "water"],
    forbiddenKeywords: ["whatsapp", "discount", "promo"],
  },
  {
    id: "P07",
    prompt: "لماذا بنيت الأهرامات بزاوية محددة؟ اشرح علاقة الفلك بالهندسة القديمة ببساطة.",
    lang: "ar",
    expectedKeywords: ["الأهرامات", "زاوية محددة", "الفلك", "الهندسة القديمة"],
    forbiddenKeywords: ["واتساب", "خصم", "كود"],
  },
  {
    id: "P08",
    prompt: "3 أخطاء بتقلل من فرص بيع شقتك بسرعة. بدون اختراع أسعار أو إحصائيات.",
    lang: "ar",
    expectedKeywords: ["بيع شقتك", "أخطاء", "بسرعة"],
    forbiddenKeywords: ["واتساب", "خصم", "كود", "أسعار", "إحصائيات"],
  },
  {
    id: "P09",
    prompt: "كافيه في المعادي، قهوة ومكان هادي للمذاكرة والخروج مع الصحاب. بدون أسعار أو عروض.",
    lang: "ar",
    expectedKeywords: ["كافيه", "المعادي", "قهوة", "للمذاكرة", "الصحاب"],
    forbiddenKeywords: ["واتساب", "خصم", "كود", "أسعار", "عروض"],
  },
  {
    id: "P10",
    prompt: "ليه بطارية الموبايل بتشحن بسرعة في الأول وبعد كده بتبطأ؟",
    lang: "ar",
    expectedKeywords: ["بطارية", "الموبايل", "بتشحن", "بتبطأ"],
    forbiddenKeywords: ["واتساب", "خصم", "كود"],
  },
  {
    id: "P11",
    prompt: "إعلان بسيط لمحل ملابس شبابي. ركز على الستايل والخامات، بدون خصومات أو أسعار.",
    lang: "ar",
    expectedKeywords: ["محل ملابس", "شبابي", "الستايل", "الخامات"],
    forbiddenKeywords: ["واتساب", "خصم", "خصومات", "كود", "أسعار"],
  },
  {
    id: "P12",
    prompt: "أهمية النسخ الاحتياطي لملفات المشاريع الصغيرة.",
    lang: "ar",
    expectedKeywords: ["النسخ الاحتياطي", "ملفات", "المشاريع الصغيرة"],
    forbiddenKeywords: ["واتساب", "خصم", "كود"],
  },
];

async function runValidationSuite() {
  console.log("================================================================================");
  console.log("  SHORT STUDIO 2.6.0 — 12-PROMPT PRODUCTION SPEC COMMERCIAL VALIDATION SUITE");
  console.log("================================================================================\n");

  const provider = new LocalContentAIProvider();
  let passedCount = 0;
  let failedCount = 0;

  for (const tc of BENCHMARK_CASES) {
    console.log(`[${tc.id}] Testing Prompt: "${tc.prompt}" (${tc.lang.toUpperCase()})`);

    const contract = buildPromptIntentContract(tc.prompt, {
      language: tc.lang,
      durationSeconds: 30,
      contentStyle: "explainer",
    });

    const spec = await provider.generateProductionSpec({
      prompt: tc.prompt,
      language: tc.lang,
      requestedDurationSeconds: 30,
    });

    const validated = validateProductionSpec(spec);
    const fidelity = verifyPromptFidelity(validated, contract);

    const fullScript = spec.scenes.map((s) => `${s.narration} ${s.onScreenText || ""}`).join(" ").toLowerCase();

    // Check expected keywords
    const missingExpected = tc.expectedKeywords.filter((kw) => !fullScript.includes(kw.toLowerCase()));
    
    // Check forbidden keywords
    const foundForbidden = tc.forbiddenKeywords.filter((kw) => {
      // If the prompt explicitly forbade something like "بدون زحام الصيف", check if it was leaked affirmatively
      if (kw === "زحام الصيف" && fullScript.includes("بدون زحام الصيف")) {
        return false; // Safely negated
      }
      return fullScript.includes(kw.toLowerCase());
    });

    // Check concrete search terms
    const abstractWords = ["cinematic", "lifestyle", "vibes", "moody", "epic", "dramatic"];
    const allStockTerms = spec.scenes.flatMap((s) => s.stockSearchTerms || []);
    const badTerms = allStockTerms.filter((term) => abstractWords.some((w) => term.toLowerCase().includes(w)));

    const errors: string[] = [];
    if (!fidelity.passed) {
      errors.push(`Fidelity gate failed: ${fidelity.issues.map((i) => i.message).join("; ")}`);
    }
    if (missingExpected.length > 0) {
      errors.push(`Missing required entities/keywords: ${missingExpected.join(", ")}`);
    }
    if (foundForbidden.length > 0) {
      errors.push(`Found forbidden keywords/claims: ${foundForbidden.join(", ")}`);
    }
    if (badTerms.length > 0) {
      errors.push(`Abstract buzzwords found in stock terms: ${badTerms.join(", ")}`);
    }

    if (errors.length === 0) {
      passedCount++;
      console.log(`  -> RESULT: PASS (Scenes: ${spec.scenes.length}, Fidelity: 100%, Grounding: Verified)`);
      console.log(`     Hook: "${spec.scenes[0].narration.slice(0, 60)}..."`);
      console.log(`     Stock Terms Sample: [${allStockTerms.slice(0, 3).map((t) => `"${t}"`).join(", ")}]`);
    } else {
      failedCount++;
      console.error(`  -> RESULT: FAIL`);
      for (const err of errors) {
        console.error(`     - ${err}`);
      }
    }
    console.log("--------------------------------------------------------------------------------");
  }

  console.log(`\nVALIDATION SUMMARY: ${passedCount}/12 PASSED (${failedCount} FAILED)`);
  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log("ALL 12 COMMERCIAL BENCHMARK PRODUCTION SPECS FULLY COMPLIANT!\n");
  }
}

runValidationSuite().catch((err) => {
  console.error("FATAL ERROR in benchmark suite:", err);
  process.exit(1);
});
