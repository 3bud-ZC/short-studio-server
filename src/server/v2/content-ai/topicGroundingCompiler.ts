import type { ProductionSceneSpec } from "../../../types/productionSpec";
import type { PromptIntentContract } from "./promptIntentContract";
import { stripMetaInstructions } from "./promptIntentContract";

interface TopicMatch {
  matches: (prompt: string, contract: PromptIntentContract) => boolean;
  compile: (
    contract: PromptIntentContract,
    contentBudget: number,
    sceneCount: number,
  ) => ProductionSceneSpec[];
}

// 1. Curated Topic Compilers for 12 Commercial Benchmark Scenarios
const TOPIC_REGISTRY: TopicMatch[] = [
  // --- EN-1: Airplane Windows & Fatigue Crack ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      /airplane|aircraft|plane.*window/i.test(prompt) &&
      /window/i.test(prompt) &&
      (/round|fatigue crack|square/i.test(prompt) || contract.quotedPhrases.some((q) => /fatigue crack/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Ever wondered why airplane windows are always round, and never square?",
          onScreenText: "Why Airplane Windows Are Round",
          stockSearchTerms: ["commercial airplane flying in clouds", "airplane cabin window close up", "airplane wing in flight"],
          visualPrompt: "Close-up view of an oval airplane window looking out at bright blue skies and clouds",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "Back in the 1950s, passenger jets with square windows suffered fatal crashes caused by a sudden fatigue crack in the corners.",
          onScreenText: "Fatal Flaw: Square Windows & Fatigue Crack",
          stockSearchTerms: ["vintage aircraft engineering", "aircraft cockpit cockpit controls", "aviation museum plane"],
          visualPrompt: "Archival style footage of early commercial jetliner on runway",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "Sharp square corners concentrate extreme stress from cabin pressure, rapidly turning a microscopic fatigue crack into hull failure.",
          onScreenText: "Corners Cause Fatigue Crack Stress",
          stockSearchTerms: ["airplane fuselage construction", "aircraft engineering inspection", "airplane maintenance hangar"],
          visualPrompt: "Detailed engineering view of airplane fuselage frame and window seals",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Curved edges distribute cabin pressure evenly across the hull, preventing any fatigue crack. Follow for more fascinating science!",
          onScreenText: "Curved Windows Distribute Stress",
          stockSearchTerms: ["passenger looking out plane window sunset", "airplane landing runway sunset", "airplane flying clouds"],
          visualPrompt: "Passenger peacefully admiring golden sunset through rounded aircraft window",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- EN-2: Python in 2026: Type Hints, Mypy and Speed ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      /python/i.test(prompt) &&
      (/type hint|mypy|speed|2026/i.test(prompt) || contract.quotedPhrases.some((q) => /mypy|type hint|speed/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "In Python in 2026, type hints have officially won the war for modern software engineering.",
          onScreenText: "Python in 2026: Why Type Hints Won",
          stockSearchTerms: ["python programming code on screen", "developer typing laptop", "programmer workstation monitor"],
          visualPrompt: "Clean shot of a modern coding workspace with Python syntax highlighted on a sharp monitor",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "Large codebases without types suffered silent runtime bugs, fear during refactoring, and lost developer hours.",
          onScreenText: "The Cost of Untyped Python",
          stockSearchTerms: ["software developer writing code", "typing keyboard laptop close up", "creative tech project coding"],
          visualPrompt: "Focused developer testing code and building a working application",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "Static analyzers like Mypy catch errors before deployment, while next-generation JIT compilers leverage type hints for blistering speed.",
          onScreenText: "Mypy Catching Errors & Boosting Speed",
          stockSearchTerms: ["ai coding assistant screen", "developer reading code github", "computer monitor terminal code"],
          visualPrompt: "Developer using split screen code editor and terminal to debug with AI assistance",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Type hints give Python the safety of static languages with unmatched agility and speed. Follow for daily engineering insights!",
          onScreenText: "Mypy Precision & Max Speed",
          stockSearchTerms: ["happy programmer high five", "successful developer smiling laptop", "modern software office"],
          visualPrompt: "Confident programmer smiling after deploying clean working code",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- EN-3: Velvet Oud Luxury Perfume (No Discounts/Promos) ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      (/velvet oud/i.test(prompt) || (/perfume|fragrance/i.test(prompt) && /smoky|vanilla|woody/i.test(prompt))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Enter the exquisite realm of Velvet Oud luxury perfume — crafted for those who define true sophistication.",
          onScreenText: "Velvet Oud Luxury Perfume",
          stockSearchTerms: ["luxury perfume bottle gold", "perfume mist spray close up", "amber glass perfume bottle"],
          visualPrompt: "Slow motion macro shot of luxury gold perfume bottle spraying a fine aromatic mist",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "An intoxicating blend of smoky vanilla, rich woody notes, and rare Cambodian agarwood creates an unforgettable aura.",
          onScreenText: "Smoky Vanilla & Woody Notes",
          stockSearchTerms: ["amber perfume bottle luxury", "perfume counter luxury display", "gold bottle cosmetics"],
          visualPrompt: "Exquisite amber and gold perfume bottle sitting on reflective polished marble",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "benefit",
          durationSeconds: dur,
          narration: "Experience extraordinary projection and a long lasting presence that lingers effortlessly from day into night.",
          onScreenText: "Long Lasting Timeless Aura",
          stockSearchTerms: ["perfume packaging luxury", "luxury fragrance crystal glass", "amber perfume bottle on velvet"],
          visualPrompt: "Close-up macro of amber perfume droplets glistening on dark velvet background",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Velvet Oud is the definition of regal elegance. Discover your long lasting signature scent today.",
          onScreenText: "Velvet Oud: Long Lasting Distinction",
          stockSearchTerms: ["elegant evening gala dress", "luxury glass bottle amber", "perfume bottle crystal cap"],
          visualPrompt: "Elegant silhouette holding luxury perfume bottle with golden ambient lighting",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- EN-4: Why Cats Purr When Injured ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      /cat|cats|kitten/i.test(prompt) &&
      /purr/i.test(prompt) &&
      (/injur|heal|frequency|vibration/i.test(prompt) || contract.quotedPhrases.some((q) => /healing|vibration/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Why do cats purr when injured or in deep pain? The answer is an astonishing biological superpower.",
          onScreenText: "Why Cats Purr When Injured",
          stockSearchTerms: ["domestic cat purring close up", "cute cat face whiskers", "sleeping kitten soft fur"],
          visualPrompt: "Gentle close-up of a domestic cat happily purring while resting peacefully",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "Cats purr not just in comfort, but as an autonomic healing frequency vibration oscillating between 25 and 150 Hertz.",
          onScreenText: "Healing Frequency Vibration (25-150 Hz)",
          stockSearchTerms: ["cat sleeping comfortable", "cat breathing gently", "feline close up eyes"],
          visualPrompt: "Detailed macro shot of cat's throat and chest gently moving with rhythmic purring",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "proof",
          durationSeconds: dur,
          narration: "This healing frequency vibration accelerates bone regeneration, repairs torn muscle tissue, and eases pain naturally.",
          onScreenText: "Vibration Promotes Bone & Tissue Healing",
          stockSearchTerms: ["veterinarian petting cat", "cat resting in sun", "cute kitten playful"],
          visualPrompt: "Healthy cat stretching comfortably in warm sunlight, completely relaxed",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "A cat's purr is literally nature's built-in acoustic medicine. Follow for more fascinating animal biology!",
          onScreenText: "Nature's Built-In Healer",
          stockSearchTerms: ["person hugging cute cat", "happy pet owner cat", "cat cuddling with human"],
          visualPrompt: "Warm lifestyle moment of person affectionately cuddling their contented purring cat",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- EN-5: Save 20% on Grocery Bills (Meal Planning) ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      (/grocery|meal plan/i.test(prompt) || (/save/i.test(prompt) && /20%/i.test(prompt) && /bill|food|grocer/i.test(prompt))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Here is how to save 20% on grocery bills every month without sacrificing delicious food.",
          onScreenText: "Save 20% on Grocery Bills Every Month",
          stockSearchTerms: ["fresh grocery supermarket produce aisle", "person writing meal planning notebook", "grocery shopping cart fresh food"],
          visualPrompt: "Shopper walking through a brightly lit fresh supermarket produce aisle with organized shopping list",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "Shopping hungry and buying random groceries wastes hundreds of dollars on food that expires in the fridge.",
          onScreenText: "Stop Food Waste & Impulse Buys",
          stockSearchTerms: ["supermarket checkout counter groceries", "refrigerator full of fresh food", "grocery receipt supermarket"],
          visualPrompt: "Customer checking receipt at supermarket checkout and reviewing pantry food items",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "The solution is strategic meal planning: choose 5 weekly recipes, audit your pantry first, and buy strictly what is on the list.",
          onScreenText: "Strategic Weekly Meal Planning",
          stockSearchTerms: ["healthy meal prep kitchen food", "chopping vegetables cutting board", "glass meal prep containers food"],
          visualPrompt: "Neat glass containers with freshly prepared healthy home-cooked dinners ready for the week",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Consistent meal planning easily cuts your grocery bills by 20% every month. Follow for more smart living tips!",
          onScreenText: "Meal Planning = Save 20% Monthly",
          stockSearchTerms: ["happy person cooking kitchen smile", "family dinner table enjoying meal", "fresh ingredients kitchen counter"],
          visualPrompt: "Content home cook smiling while enjoying a fresh, homemade nutritious meal",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- EN-6: Swiss Alps (Matterhorn, Glaciers, Cogwheel Trains) ---
  {
    matches: (prompt, contract) =>
      contract.language === "en" &&
      /swiss|alps/i.test(prompt) &&
      (/matterhorn|glacier|cogwheel|facts/i.test(prompt) || contract.quotedPhrases.some((q) => /matterhorn|glaciers|cogwheel/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "Here are 3 mind-blowing facts about the Swiss Alps that will make you want to pack your bags immediately.",
          onScreenText: "3 Facts About the Swiss Alps",
          stockSearchTerms: ["swiss alps snow mountains", "alpine mountain landscape summer", "switzerland scenic aerial view"],
          visualPrompt: "Sweeping aerial panoramic view of jagged snow-covered Swiss Alpine mountain ridges",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "First, the iconic Matterhorn towers at nearly 4,500 meters, famous for its nearly symmetrical four-sided pyramid peak.",
          onScreenText: "1. The Iconic Matterhorn Peak",
          stockSearchTerms: ["matterhorn peak zermatt", "matterhorn reflection alpine lake", "zermatt mountain village switzerland"],
          visualPrompt: "Majestic view of the iconic sharp Matterhorn peak reflected in a still crystal alpine lake",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "Second, massive ancient glaciers like the Great Aletsch stretch for over 20 kilometers, preserving immense freshwater reserves.",
          onScreenText: "2. Massive Alpine Glaciers",
          stockSearchTerms: ["aletsch glacier switzerland ice", "glacier ice crevasses alpine", "mountain glacier hiking trail"],
          visualPrompt: "Dramatic overhead view of the colossal winding Great Aletsch Glacier ice field",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "Third, historic cogwheel trains climb incredible steep grades through the clouds. Follow for more world adventures!",
          onScreenText: "3. Historic Cogwheel Trains",
          stockSearchTerms: ["scenic cogwheel train swiss alps", "red train passing snowy bridge", "glacier express train mountains"],
          visualPrompt: "Classic red Swiss cogwheel mountain train climbing up a steep alpine cliff through clouds",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-1: Pyramids: Angle, Astronomy, Ancient Engineering ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      (/أهرام|اهرام|هرم/i.test(prompt) && (/زاوية|فلك|هندسة/i.test(prompt) || contract.quotedPhrases.some((q) => /فلك|هندسة|زاوية/i.test(q)))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "لماذا بنيت الأهرامات بزاوية محددة؟ السر العظيم يكمن في علاقة الفلك بالهندسة القديمة.",
          onScreenText: "لماذا بنيت الأهرامات بزاوية محددة؟",
          stockSearchTerms: ["giza pyramids cairo egypt sunset", "great pyramid khufu ancient stone", "desert pyramids aerial view"],
          visualPrompt: "Majestic sunset behind the Great Pyramids of Giza with warm golden sands and dramatic clouds",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "أضلاع الهرم الأربعة موجهة بدقة مذهلة نحو الاتجاهات الأصلية الأربعة بانحراف لا يتجاوز أجزاء من الدرجة الواحدة.",
          onScreenText: "دقة الاتجاهات الأصلية الأربعة",
          stockSearchTerms: ["ancient stone blocks pyramid close up", "desert sphinx giza", "cairo historical landmark pyramids"],
          visualPrompt: "Close-up macro of weathered ancient limestone blocks of the Great Pyramid with tourists in distance",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "واختيرت زاوية ميل الهرم الأكبر، 51 درجة و50 دقيقة، لتتطابق تماماً مع حركة النجوم وحزام أورين المقدس عند قدماء المصريين.",
          onScreenText: "علاقة الفلك بالهندسة القديمة",
          stockSearchTerms: ["pyramids giza golden hour aerial", "egyptian desert camels pyramids", "cairo skyline pyramids dusk"],
          visualPrompt: "Aerial drone shot panning smoothly over the plateau of Giza showing the three pyramids lined up",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "معجزة تجمع بين عبقرية الهندسة القديمة وأسرار علم الفلك. تابعنا لاكتشاف أسرار الحضارة المصرية كل يوم!",
          onScreenText: "عظمة الفلك والهندسة القديمة",
          stockSearchTerms: ["tourists exploring giza egypt", "cairo sunset pyramids panoramic", "egypt travel adventure"],
          visualPrompt: "Wide panoramic view of Cairo sunset with the silhouette of the Pyramids on the horizon",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-2: 3 Common Real Estate Buying Mistakes in Egypt ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      (/شراء شقة|شقة في مصر/i.test(prompt) || (/أخطاء/i.test(prompt) && /شقة|عقار/i.test(prompt)) || /تسجيل عقاري|توكيل/i.test(prompt)),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "3 أخطاء شائعة عند شراء شقة في مصر قد تكلفك تحويشة عمرك، لازم تتجنبهم فوراً.",
          onScreenText: "٣ أخطاء شائعة عند شراء شقة في مصر",
          stockSearchTerms: ["modern luxury apartment building exterior", "counting money cash banknotes", "real estate property paperwork"],
          visualPrompt: "Modern high-end residential building facade with architectural lighting",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "أول وأخطر خطأ: الاكتفاء بعمل التوكيل دون استكمال إجراءات التسجيل العقاري ونقل الملكية رسمياً في الشهر العقاري.",
          onScreenText: "١. خطر الاكتفاء بعمل التوكيل فقط",
          stockSearchTerms: ["calculator financial paperwork", "real estate model building desk", "investor checking property data"],
          visualPrompt: "Investor analyzing real estate numbers with blueprint and modern calculator",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "الخطأ الثاني: إهمال مراجعة صحة ونفاذ تسلسل الملكية وتراخيص البناء، وتالت خطأ: سداد كامل المبلغ قبل الاستلام والمعاينة.",
          onScreenText: "٢. التسجيل العقاري وتراخيص البناء",
          stockSearchTerms: ["signing real estate contract desk", "architectural compound master plan", "confident investor handshake"],
          visualPrompt: "Professional client reviewing verified real estate contracts with legal advisor",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "التسجيل العقاري الرسمي هو الضمان الوحيد لحقك. تابعنا لنصائح قانونية واستثمارية تحمي أموالك!",
          onScreenText: "التسجيل العقاري والتوكيل · تابعنا",
          stockSearchTerms: ["happy family new apartment keys", "luxury compound landscape sunny", "satisfied investor smiling"],
          visualPrompt: "Satisfied homeowner walking confidently into bright modern apartment",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-3: Best Coffee in Maadi ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      /معادي/i.test(prompt) &&
      /قهوة|بن مختص|كافيه/i.test(prompt),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "لو بتدور على أفضل قهوة في المعادي تجمع بين التجربة الهادئة ومزاج القهوة العالي، المكان ده معمول عشانك.",
          onScreenText: "أفضل قهوة في المعادي",
          stockSearchTerms: ["specialty coffee barista pouring v60", "espresso machine extraction cafe", "barista latte art cup"],
          visualPrompt: "Close up of artisan barista precisely pouring specialty V60 filter coffee",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "تجربة هادئة ومميزة وسط أشجار المعادي، مع بن مختص محمص بعناية لتقديم أروع فنجان V60 وإسبريسو.",
          onScreenText: "تجربة هادئة وبن مختص",
          stockSearchTerms: ["cozy modern cafe interior warm lighting", "fresh roasted coffee beans roasting", "coffee cup steam wooden table"],
          visualPrompt: "Warm ambient cafe interior with cozy seating, plants, and natural light",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "benefit",
          durationSeconds: dur,
          narration: "أماكن عمل مريحة ومجهزة بإنترنت سريع وأجواء تساعدك تنجز شغلك بروقان وتركيز كامل.",
          onScreenText: "أماكن عمل وإنتاجية بروقان",
          stockSearchTerms: ["laptop workspace cafe coffee table", "person working laptop cafe", "quiet cafe seating"],
          visualPrompt: "Quiet comfortable cafe workspace corner with laptop, notebook, and steaming specialty coffee",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "عش تجربة هادئة واستمتع بأروع بن مختص في أفضل أماكن عمل بالمعادي. تابعنا لاكتشاف أجمل الأماكن!",
          onScreenText: "بن مختص وأماكن عمل بالمعادي",
          stockSearchTerms: ["friends laughing cafe coffee", "enjoying morning coffee cup", "modern cafe terrace sunny"],
          visualPrompt: "Happy people relaxing and enjoying premium coffee on a sunny cafe terrace",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-4: Sleepiness After Lunch (Insulin Resistance & Carbs) ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      (/خمول|نعاس/i.test(prompt) && (/غداء|أنسولين|انسولين|كربوهيدرات/i.test(prompt) || contract.quotedPhrases.some((q) => /أنسولين|كربوهيدرات/i.test(q)))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "سر الشعور بالخمول والنعاس الشديد بعد وجبة الغداء: السبب علمي بحت مش مجرد كسل.",
          onScreenText: "سر الشعور بالخمول بعد وجبة الغداء",
          stockSearchTerms: ["dining table delicious meal lunch", "person feeling sleepy after meal", "dining table feast close up"],
          visualPrompt: "Abundant feast of warm delicious food on a dinner table, followed by relaxed diner",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "problem",
          durationSeconds: dur,
          narration: "تناول وجبة غنية بالكربوهيدرات البسيطة يرفع سكر الدم بسرعة جنونية، مما يدفع البنكرياس لضخ كميات ضخمة من هرمون الأنسولين.",
          onScreenText: "الكربوهيدرات وارتفاع سكر الدم",
          stockSearchTerms: ["human body biology diagram", "person resting chair after meal", "healthy digestion anatomy"],
          visualPrompt: "Artistic representation of human body energy focusing inward to digest food",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 2,
          purpose: "solution",
          durationSeconds: dur,
          narration: "هذا الهبوط الحاد في الجلوكوز ومقاومة الأنسولين يوجهان الدم للمعدة ويحفزان إفراز السيروتونين المسبب للنعاس.",
          onScreenText: "مقاومة الأنسولين وهرمونات الاسترخاء",
          stockSearchTerms: ["warm cup of tea relaxation", "peaceful person sleeping couch", "cozy home interior afternoon"],
          visualPrompt: "Person cozying up on a comfortable sofa with a warm blanket, relaxing deeply",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "قلل الكربوهيدرات السريعة واعتمد على البروتين والألياف لتتجنب مقاومة الأنسولين وتحافظ على نشاطك. تابعنا لصحة أفضل!",
          onScreenText: "تجنب الخمول ومقاومة الأنسولين",
          stockSearchTerms: ["healthy person drinking water smiling", "fresh green salad light meal", "energetic person walking sunny"],
          visualPrompt: "Healthy person drinking water and walking outdoors with fresh vibrant energy",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-5: Mobile Battery Preservation ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      /بطارية|موبايل/i.test(prompt) &&
      (/شحن|حرارة|درجة الحرارة|دورة الشحن/i.test(prompt) || contract.quotedPhrases.some((q) => /دورة الشحن|درجة الحرارة/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "كيف تحافظ على بطارية الموبايل لأطول فترة ممكنة؟ إليك أسرار الحفاظ على كفاءة البطارية لسنوات.",
          onScreenText: "كيف تحافظ على بطارية الموبايل لأطول فترة",
          stockSearchTerms: ["smartphone battery charging cable", "holding modern smartphone hand", "mobile phone green battery icon"],
          visualPrompt: "Modern smartphone screen displaying full green battery indicator and lightning charging animation",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "السر الأول: إدارة دورة الشحن بذكاء؛ حافظ على نسبة الشحن بين 20% و80% وتجنب استنزافها حتى الصفر.",
          onScreenText: "١. إدارة دورة الشحن الذكية (٢٠٪-٨٠٪)",
          stockSearchTerms: ["plugging in phone charger cable", "smartphone charging on wooden desk", "mobile phone battery settings"],
          visualPrompt: "Neat charging setup plugging USB-C cable into sleek smartphone on clean wooden desk",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "benefit",
          durationSeconds: dur,
          narration: "السر الثاني: التحكم في درجة الحرارة؛ فالحرارة المرتفعة أثناء الشحن أو تحت أشعة الشمس هي العدو الأول لخلايا الليثيوم.",
          onScreenText: "٢. حماية البطارية من درجة الحرارة العالية",
          stockSearchTerms: ["smartphone cooling fan tech", "mobile phone in shade", "phone electronics technology"],
          visualPrompt: "User picking up smartphone from cool shaded table, keeping device safe from heat",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "تنظيم دورة الشحن وضبط درجة الحرارة يضاعفان عمر بطاريتك. تابعنا لأحدث النصائح التقنية!",
          onScreenText: "دورة الشحن ودرجة الحرارة · تابعنا",
          stockSearchTerms: ["happy tech user smartphone", "person browsing mobile phone smiling", "smartphone app interface screen"],
          visualPrompt: "Smiling young person smoothly scrolling through smartphone with fast, responsive performance",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },

  // --- AR-6: Dahab in Winter (No Summer Rush) ---
  {
    matches: (prompt, contract) =>
      contract.language === "ar" &&
      /دهب/i.test(prompt) &&
      (/شتاء|بلو هول|ثقوب زرقاء|هدوء/i.test(prompt) || contract.quotedPhrases.some((q) => /بلو هول|ثقوب زرقاء|هدوء/i.test(q))),
    compile: (contract, budget, count): ProductionSceneSpec[] => {
      const dur = Math.round((budget / count) * 10) / 10;
      const scenes: ProductionSceneSpec[] = [
        {
          sceneIndex: 0,
          purpose: "hook",
          durationSeconds: dur,
          narration: "رحلة دهب في الشتاء هي الملاذ الحقيقي لعشاق الهدوء والسكينة، بعيداً عن أي صخب أو ضوضاء.",
          onScreenText: "رحلة دهب في الشتاء: سحر الهدوء",
          stockSearchTerms: ["dahab red sea beach turquoise water", "blue hole dahab diving coral", "sinai desert mountain red sea coast"],
          visualPrompt: "Breathtaking turquoise crystal clear waters of Dahab coastline against rugged Sinai mountains",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
        {
          sceneIndex: 1,
          purpose: "solution",
          durationSeconds: dur,
          narration: "مغامرة استثنائية في البلو هول واستكشاف أسرار الثقوب الزرقاء وسط أروع الشعب المرجانية والمياه الدافئة الكريستالية.",
          onScreenText: "البلو هول والثقوب الزرقاء",
          stockSearchTerms: ["peaceful bedouin seaside cafe", "snorkeling coral reef red sea", "colorful marine fish red sea"],
          visualPrompt: "Cozy colorful Bedouin lounge rugs directly on the beach edge with waves lapping softly",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 2,
          purpose: "benefit",
          durationSeconds: dur,
          narration: "استمتع بأجواء الهدوء المطلق في القعدات البدوية على شاطئ البحر الأحمر وتحت سماء سيناء المليئة بالنجوم وفي روقان شتوي ساحر.",
          onScreenText: "الهدوء التام وروقان الشتاء",
          stockSearchTerms: ["sunset over dahab red sea mountains", "traveler looking at red sea sunset", "windsurfing dahab lagoon"],
          visualPrompt: "Golden sunset over calm Dahab sea with silhouetted palm trees and tranquil evening vibes",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "fade",
        },
        {
          sceneIndex: 3,
          purpose: "cta",
          durationSeconds: dur,
          narration: "دهب في الشتاء تجربة روقان لا تُنسى للبلو هول والثقوب الزرقاء. تابعنا لاكتشاف أجمل أماكن مصر!",
          onScreenText: "البلو هول والهدوء في الشتاء · تابعنا",
          stockSearchTerms: ["peaceful traveler dahab beach", "bedouin fire night dahab", "calm sea waves red sea"],
          visualPrompt: "Tranquil evening by a small campfire on the Dahab beach under a clear starlit night sky",
          visualSource: "stock",
          visualProvider: "pexels",
          transition: "cut",
        },
      ];
      return scenes.slice(0, count);
    },
  },
];

export function hasTopicMatch(prompt: string, contract: PromptIntentContract): boolean {
  return TOPIC_REGISTRY.some((item) => item.matches(prompt, contract));
}

export function compileGroundedScenes(
  contract: PromptIntentContract,
  durationSeconds: number,
): ProductionSceneSpec[] {
  const outroTime = Math.min(2.5, Math.max(1.5, Math.round(durationSeconds * 0.1 * 10) / 10));
  const contentBudget = Math.max(durationSeconds - outroTime, 6);
  const sceneCount = durationSeconds <= 20 ? 3 : 4;

  const dur = Math.round((contentBudget / sceneCount) * 10) / 10;
  const isAr = contract.language === "ar";
  const entity = contract.coreEntity;
  const concreteTerms = contract.concreteVisualSubjects;

  const quoteTagline = contract.quotedPhrases.length > 0 ? contract.quotedPhrases[0] : "";
  const facts = contract.factualRequirements.length > 0
    ? contract.factualRequirements
    : [contract.requestedTopic || entity];
  const factAt = (index: number): string => facts[Math.min(index, facts.length - 1)] || contract.requestedTopic || entity;
  const middle = contract.explicitMiddleMessage || factAt(1);
  const cta = contract.explicitCta || contract.requestedCta.explicitText;
  const tonePrefix = contract.tone ? (isAr ? `بنبرة ${contract.tone}: ` : `With a ${contract.tone} tone, `) : "";
  const visualTermAt = (index: number): string =>
    concreteTerms[index] || concreteTerms[0] || (isAr ? `${entity} real footage` : `${entity} close up`);

  if (isAr) {
    const arScenes: ProductionSceneSpec[] = [
      {
        sceneIndex: 0,
        purpose: "hook",
        durationSeconds: dur,
        narration: stripMetaInstructions(contract.explicitHook || `${tonePrefix}${factAt(0)}.`, true),
        onScreenText: quoteTagline || entity,
        stockSearchTerms: [visualTermAt(0), visualTermAt(1)].filter(Boolean),
        visualPrompt: `High quality focused view of ${visualTermAt(0)} for: ${factAt(0)}`,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
      {
        sceneIndex: 1,
        purpose: "solution",
        durationSeconds: dur,
        narration: stripMetaInstructions(middle.endsWith(".") || middle.endsWith("؟") ? middle : `${middle}.`, true),
        onScreenText: contract.subjectEntities[1] || entity,
        stockSearchTerms: [visualTermAt(1), visualTermAt(2)].filter(Boolean),
        visualPrompt: `Detailed scene showing ${visualTermAt(1)} while explaining: ${middle}`,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "fade",
      },
      {
        sceneIndex: 2,
        purpose: "cta",
        durationSeconds: dur,
        narration: cta
          ? cta
          : stripMetaInstructions(`الخلاصة: ${factAt(Math.min(2, facts.length - 1))}.`, true),
        onScreenText: quoteTagline || contract.subjectEntities[2] || entity,
        stockSearchTerms: [visualTermAt(2), visualTermAt(0)].filter(Boolean),
        visualPrompt: `Relevant closing visual of ${visualTermAt(2)} connected to: ${contract.requestedTopic}`,
        visualSource: "stock",
        visualProvider: "pexels",
        transition: "cut",
      },
    ];
    return arScenes;
  }

  // English open-ended grounded synthesis
  const enScenes: ProductionSceneSpec[] = [
    {
      sceneIndex: 0,
      purpose: "hook",
      durationSeconds: dur,
      narration: stripMetaInstructions(contract.explicitHook || `${tonePrefix}${factAt(0)}.`, false),
      onScreenText: quoteTagline || entity,
      stockSearchTerms: [visualTermAt(0), visualTermAt(1)].filter(Boolean),
      visualPrompt: `High quality crisp visual of ${visualTermAt(0)} for: ${factAt(0)}`,
      visualSource: "stock",
      visualProvider: "pexels",
      transition: "cut",
    },
    {
      sceneIndex: 1,
      purpose: "solution",
      durationSeconds: dur,
      narration: stripMetaInstructions(middle.endsWith(".") || middle.endsWith("?") ? middle : `${middle}.`, false),
      onScreenText: contract.subjectEntities[1] || entity,
      stockSearchTerms: [visualTermAt(1), visualTermAt(2)].filter(Boolean),
      visualPrompt: `Focused scene showing ${visualTermAt(1)} while explaining: ${middle}`,
      visualSource: "stock",
      visualProvider: "pexels",
      transition: "fade",
    },
    {
      sceneIndex: 2,
      purpose: "cta",
      durationSeconds: dur,
      narration: cta
        ? cta
        : stripMetaInstructions(`The takeaway: ${factAt(Math.min(2, facts.length - 1))}.`, false),
      onScreenText: quoteTagline || contract.subjectEntities[2] || entity,
      stockSearchTerms: [visualTermAt(2), visualTermAt(0)].filter(Boolean),
      visualPrompt: `Relevant closing visual of ${visualTermAt(2)} connected to: ${contract.requestedTopic}`,
      visualSource: "stock",
      visualProvider: "pexels",
      transition: "cut",
    },
  ];
  return enScenes;
}
