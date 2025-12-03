// ===============================================================
//  NovaFlowController.ts — V7.1 (Production-ready, Google-level)
// ---------------------------------------------------------------
//  Règles métier :
//   - Q1 : question générale q_0001 (gérée via orchestrate).
//   - Phase GENERAL (après Q1) :
//       * Flow pose jusqu'à 5 questions GENERAL max (Q1 incluse).
//       * Si le pack ne contient que 2 ou 3 GENERAL → Flow pose ce qu'il a,
//         puis passe aux DOMAIN (aucun ajout artificiel).
//   - Phase DOMAIN (GMAT) :
//       * Jusqu'à 20 questions DOMAIN max.
//       * GMAT : score >= 65 → niveau++, score < 50 → niveau--, sinon niveau stable.
//       * Fallback niveau :
//           lvl1 -> 1 -> 2 -> 3
//           lvl2 -> 2 -> 1 -> 3
//           lvl3 -> 3 -> 2 -> 1
//   - Fallback GENERAL après DOMAIN :
//       * Si DOMAIN épuisé, mais GENERAL pool encore non vide,
//         Flow peut utiliser ces GENERAL restantes tant que total < 25.
//   - Total max = 25 questions (GENERAL + DOMAIN).
//   - Si tout est épuisé ou limite atteinte → fin de session (fetchNextQuestion → null).
// ===============================================================

import { getSystemVideo } from "@/lib/videoManager"

export type FlowState =
  | "INIT"
  | "INTRO_1"
  | "INTRO_2"
  | "Q1_AUDIO"
  | "Q1_VIDEO"
  | "RUN_AUDIO"
  | "RUN_VIDEO"
  | "ENDING"
  | "FEEDBACK_IDLE"
  | "RELANCE"

export interface FlowContext {
  session_id: string
  lang: string
  mode: "audio" | "video"
  firstname?: string | null

  currentQuestion?: any | null
  nextQuestions?: any[] | null
  state: FlowState

  // Pools dérivés de nextQuestions
  poolsInitialized: boolean
  generalPool: any[]              // domain === "general", triées par difficulté asc.
  domainPool: { 1: any[]; 2: any[]; 3: any[] }

  // Compteurs
  questionCount: number           // total questions posées (Q1 + GENERAL + DOMAIN)
  generalQuestionsCount: number   // nb de GENERAL posées (Q1 incluse)
  maxInitialGeneral: number       // cible Q1–Q5 (max 5 GENERAL)
  maxDomainQuestions: number      // 20 max
  currentDifficulty: 1 | 2 | 3    // niveau courant GMAT
  scores: number[]
}

export class NovaFlowController {
  ctx: FlowContext

  constructor(session_id: string, lang: string, mode: "audio" | "video", firstname?: string | null) {
    this.ctx = {
      session_id,
      lang,
      mode,
      firstname,
      currentQuestion: null,
      nextQuestions: null,
      state: "INIT",
      poolsInitialized: false,
      generalPool: [],
      domainPool: { 1: [], 2: [], 3: [] },
      questionCount: 0,
      generalQuestionsCount: 0,
      maxInitialGeneral: 5,
      maxDomainQuestions: 20,
      currentDifficulty: 1,
      scores: [],
    }

    console.log("[Nova] FlowController V7.1 initialized", {
      session_id,
      lang,
      mode,
      maxInitialGeneral: this.ctx.maxInitialGeneral,
      maxDomain: this.ctx.maxDomainQuestions,
      maxTotal: this.ctx.maxInitialGeneral + this.ctx.maxDomainQuestions, // 25
    })
  }

  // -----------------------------------------------------------
  // Transition sécurisée
  // -----------------------------------------------------------
  private transition(next: FlowState) {
    console.log(`[Nova] STATE: ${this.ctx.state} -> ${next}`)
    this.ctx.state = next
  }

  // ===========================================================
  // 0. INIT POOLS (GENERAL + DOMAIN) à partir de nextQuestions
  // ===========================================================
  private ensurePools() {
    if (this.ctx.poolsInitialized) return

    const src = Array.isArray(this.ctx.nextQuestions) ? this.ctx.nextQuestions : []

    const general: any[] = []
    const d1: any[] = []
    const d2: any[] = []
    const d3: any[] = []

    for (const q of src) {
      if (!q) continue
      if (q.domain === "general") {
        general.push(q)
      } else {
        const diff = typeof q.difficulty === "number" ? q.difficulty : 1
        if (diff <= 1) d1.push(q)
        else if (diff === 2) d2.push(q)
        else d3.push(q)
      }
    }

    // GENERAL : on commence par la difficulté la plus basse dispo
    general.sort((a, b) => (a.difficulty || 1) - (b.difficulty || 1))

    this.ctx.generalPool = general
    this.ctx.domainPool = { 1: d1, 2: d2, 3: d3 }
    this.ctx.poolsInitialized = true

    console.log("[Nova] ensurePools()", {
      general: general.length,
      domain1: d1.length,
      domain2: d2.length,
      domain3: d3.length,
      total: general.length + d1.length + d2.length + d3.length,
    })
  }

  // ===========================================================
  // 1. INTRO FLOW
  // ===========================================================
  async getIntro1() {
    this.transition("INTRO_1")
    return await getSystemVideo(`intro_${this.ctx.lang}_1`, this.ctx.lang)
  }

  async getIntro2() {
    this.transition("INTRO_2")
    return await getSystemVideo(`intro_${this.ctx.lang}_2`, this.ctx.lang)
  }

  // ===========================================================
  // 2. Q1 — appelle orchestrate si besoin
  // ===========================================================
  async fetchQ1() {
    console.log("[Nova] fetchQ1() called")

    // CAS 1 - Q1 déjà injectée côté front
    if (this.ctx.currentQuestion && (!this.ctx.nextQuestions || this.ctx.nextQuestions.length === 0)) {
      console.log("[Nova] Q1 déjà injectée par le front")
      this.ctx.questionCount = 1
      this.ctx.generalQuestionsCount = 1
      return this.returnQuestion(this.ctx.currentQuestion, "Q1")
    }

    // CAS 2 - Q1 + nextQuestions déjà définies
    if (this.ctx.currentQuestion && Array.isArray(this.ctx.nextQuestions)) {
      console.log("[Nova] Q1 déjà définie, utilisation directe")
      this.ctx.questionCount = 1
      this.ctx.generalQuestionsCount = 1
      return this.returnQuestion(this.ctx.currentQuestion, "Q1")
    }

    // CAS 3 - Appel orchestrate
    console.log("[Nova] Calling orchestrate API...")
    const res = await fetch("/api/engine/orchestrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: this.ctx.session_id }),
    }).catch((e) => {
      console.error("[Nova] Orchestrate call failed:", e)
      return null
    })

    if (!res) {
      console.error("[Nova] Orchestrate response is null")
      return null
    }

    let json: any = null
    try {
      json = await res.json()
    } catch (e) {
      console.error("[Nova] Orchestrate JSON parse error:", e)
      return null
    }

    if (!json || (!Array.isArray(json.questions) && !json.question)) {
      console.error("[Nova] Orchestrate payload invalide:", json)
      return null
    }

    const q1 = json.question || json.questions?.[0]
    if (!q1) {
      console.error("[Nova] Orchestrate n'a pas fourni q1")
      return null
    }

    this.ctx.currentQuestion = q1

    // Stocker toutes les autres questions dans nextQuestions
    const allQuestions = Array.isArray(json.questions) ? [...json.questions] : []
    if (allQuestions.length && allQuestions[0]?.question_id === q1.question_id) {
      allQuestions.shift()
    }

    this.ctx.nextQuestions = allQuestions
    this.ctx.poolsInitialized = false

    this.ctx.questionCount = 1
    this.ctx.generalQuestionsCount = 1

    console.log("[Nova] Q1:", q1.question_id, "| diff:", q1.difficulty, "| domain:", q1.domain)
    console.log("[Nova] Questions restantes:", this.ctx.nextQuestions.length)

    return this.returnQuestion(q1, "Q1")
  }

  // ===========================================================
  // 3. RUNNING QUESTIONS — GENERAL puis DOMAIN GMAT + fallback
  // ===========================================================
  async fetchNextQuestion() {
    const maxTotal = this.ctx.maxInitialGeneral + this.ctx.maxDomainQuestions // 25

    console.log("[Nova] fetchNextQuestion() called")
    console.log("[Nova] questionCount:", this.ctx.questionCount, "/", maxTotal)
    console.log("[Nova] generalCount:", this.ctx.generalQuestionsCount, "/", this.ctx.maxInitialGeneral)

    // Limite totale
    if (this.ctx.questionCount >= maxTotal) {
      console.log("[Nova] LIMITE ATTEINTE - 25 questions posées")
      return null
    }

    if (!Array.isArray(this.ctx.nextQuestions)) {
      console.warn("[Nova] nextQuestions non initialisé")
      return null
    }

    this.ensurePools()

    const generalRemaining = this.ctx.generalPool.length
    const domainRemaining =
      this.ctx.domainPool[1].length + this.ctx.domainPool[2].length + this.ctx.domainPool[3].length

    const domainCount = this.ctx.questionCount - this.ctx.generalQuestionsCount

    console.log("[Nova] generalRemaining:", generalRemaining, "| domainRemaining:", domainRemaining)

    if (generalRemaining === 0 && domainRemaining === 0) {
      console.log("[Nova] Aucune question restante (GENERAL + DOMAIN épuisés)")
      return null
    }

    let next: any = null

    // PHASE GENERAL (initiale) — on veut poser jusqu'à maxInitialGeneral GENERAL (Q1 comprise)
    if (this.ctx.generalQuestionsCount < this.ctx.maxInitialGeneral && generalRemaining > 0) {
      console.log("[Nova] Phase: GENERAL (initiale)")
      next = this.pickNextGeneral()
      if (next) {
        this.ctx.generalQuestionsCount++
        console.log("[Nova] Question GENERAL", this.ctx.generalQuestionsCount, ":", next.question_id)
      }
    }

    // PHASE DOMAIN (GMAT)
    if (!next && domainCount < this.ctx.maxDomainQuestions) {
      if (domainRemaining > 0) {
        console.log("[Nova] Phase: DOMAIN (GMAT)")
        next = this.pickNextDomainGMAT()
        if (next) {
          console.log("[Nova] Question DOMAIN", domainCount + 1, ":", next.question_id, "| diff:", next.difficulty)
        }
      } else {
        // DOMAIN épuisé → fallback GENERAL *si* il en reste encore
        if (generalRemaining > 0 && this.ctx.questionCount < maxTotal) {
          console.log("[Nova] FALLBACK: DOMAIN épuisé, utilisation GENERAL restantes")
          next = this.pickNextGeneral()
          if (next) {
            this.ctx.generalQuestionsCount++
            console.log("[Nova] Question GENERAL (fallback):", next.question_id)
          }
        }
      }
    }

    if (!next) {
      console.log("[Nova] Aucune question trouvée (GENERAL + DOMAIN + fallback)")
      return null
    }

    this.ctx.currentQuestion = next
    this.ctx.questionCount++

    console.log("[Nova] Question", this.ctx.questionCount, ":", next.question_id)
    console.log("[Nova] difficulty:", next.difficulty, "| domain:", next.domain)

    return this.returnQuestion(next, "RUN")
  }

  // ===========================================================
  // 4. FEEDBACK + ajustement GMAT (DOMAIN uniquement)
  // ===========================================================
  async sendFeedback(transcript: string) {
    if (!this.ctx.currentQuestion) return null

    const q = this.ctx.currentQuestion
    const lang = this.ctx.lang

    console.log("[Nova] sendFeedback() pour question:", q.question_id)

    const res = await fetch("/api/engine/feedback-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: this.ctx.session_id,
        question_id: q.id,
        question_text: q[`question_${lang}`] || q.question_en || "",
        answer_text: transcript || "",
        lang,
      }),
    }).catch((e) => {
      console.error("[Nova] /feedback-question error:", e)
      return null
    })

    if (!res) return null

    let json: any = null
    try {
      json = await res.json()
    } catch (e) {
      console.error("[Nova] /feedback-question JSON error:", e)
      return null
    }

    const score = json?.score_auto ?? 0
    console.log("[Nova] Feedback reçu - score_auto:", score)

    // Ajustement GMAT seulement pour DOMAIN (pas pour GENERAL ni fallback GENERAL)
    const isDomainQuestion = this.ctx.currentQuestion?.domain !== "general"

    if (this.ctx.generalQuestionsCount >= this.ctx.maxInitialGeneral && isDomainQuestion) {
      this.adjustDifficultyGMAT(score)
    } else {
      console.log("[Nova] Pas d'ajustement GMAT (GENERAL ou phase GENERAL)")
    }

    this.transition("FEEDBACK_IDLE")
    return {
      type: "idle_feedback",
      idle_url: await this.getIdleListen(),
      feedback: json,
    }
  }

  // ===========================================================
  // HELPERS — GENERAL & DOMAIN
  // ===========================================================

  // GENERAL : on prend la question de difficulté la plus basse dispo
  private pickNextGeneral(): any | null {
    if (!this.ctx.generalPool.length) return null
    const q = this.ctx.generalPool.shift()!
    this.ctx.currentQuestion = q
    return q
  }

  // DOMAIN GMAT : ajustement de la difficulté
  private adjustDifficultyGMAT(score: number) {
    this.ctx.scores.push(score)
    const old = this.ctx.currentDifficulty

    if (score >= 65) {
      if (this.ctx.currentDifficulty < 3) this.ctx.currentDifficulty++
      console.log("[Nova] GMAT: BONNE (", score, ") diff:", old, "->", this.ctx.currentDifficulty)
    } else if (score < 50) {
      if (this.ctx.currentDifficulty > 1) this.ctx.currentDifficulty--
      console.log("[Nova] GMAT: MAUVAISE (", score, ") diff:", old, "->", this.ctx.currentDifficulty)
    } else {
      console.log("[Nova] GMAT: MOYENNE (", score, "), diff reste:", this.ctx.currentDifficulty)
    }
  }

  // DOMAIN : sélection GMAT avec fallback 1→2→3, 2→1→3, 3→2→1
  private pickNextDomainGMAT(): any | null {
    const dp = this.ctx.domainPool
    const totalLeft = dp[1].length + dp[2].length + dp[3].length

    if (totalLeft === 0) {
      console.log("[Nova] DOMAIN pools vides")
      return null
    }

    const tryLevel = (lvl: 1 | 2 | 3): any | null => {
      if (dp[lvl].length > 0) {
        const q = dp[lvl].shift()!
        this.ctx.currentDifficulty = lvl
        this.ctx.currentQuestion = q
        return q
      }
      return null
    }

    const lvl = this.ctx.currentDifficulty
    let q: any | null = null

    if (lvl === 1) {
      q = tryLevel(1) || tryLevel(2) || tryLevel(3)
    } else if (lvl === 2) {
      q = tryLevel(2) || tryLevel(1) || tryLevel(3)
    } else {
      q = tryLevel(3) || tryLevel(2) || tryLevel(1)
    }

    return q
  }

  // Retourne la question formatée
  private returnQuestion(q: any, phase: "Q1" | "RUN") {
    const videoUrl = this.ctx.lang === "fr" ? q.video_url_fr || q.video_url_en : q.video_url_en || q.video_url_fr

    if (this.ctx.mode === "audio") {
      this.transition(phase === "Q1" ? "Q1_AUDIO" : "RUN_AUDIO")
      return { type: "audio", question: q }
    }

    this.transition(phase === "Q1" ? "Q1_VIDEO" : "RUN_VIDEO")
    return {
      type: "video",
      url:
        videoUrl ||
        "https://qpnalviccuopdwfscoli.supabase.co/storage/v1/object/public/system/question_missing.mp4",
      question: q,
    }
  }

  // ===========================================================
  // 5. IDLE VIDEOS
  // ===========================================================
  async getIdleListen() {
    return await getSystemVideo("idle_listen", this.ctx.lang)
  }

  async getIdleSmile() {
    try {
      return await getSystemVideo("idle_smile", this.ctx.lang)
    } catch {
      return this.getIdleListen()
    }
  }

  async getIdleAlt() {
    try {
      return await getSystemVideo("listen_idle_01", this.ctx.lang)
    } catch {
      return this.getIdleListen()
    }
  }

  // ===========================================================
  // 6. RELANCE
  // ===========================================================
  async getRelance() {
    const lang = this.ctx.lang || "en"
    console.log("[Nova] getRelance() - lang:", lang)

    try {
      return await getSystemVideo("clarify_start", lang)
    } catch {}

    try {
      return await getSystemVideo(`clarify_${lang}`, lang)
    } catch {}

    return await this.getIdleSmile()
  }

  // ===========================================================
  // 7. SESSION END
  // ===========================================================
  async endSession() {
    console.log("[Nova] endSession() called")
    console.log("[Nova] Total questions posées:", this.ctx.questionCount)
    console.log("[Nova] Questions GENERAL:", this.ctx.generalQuestionsCount)
    console.log("[Nova] Questions DOMAIN:", this.ctx.questionCount - this.ctx.generalQuestionsCount)
    console.log("[Nova] Scores:", this.ctx.scores)
    console.log(
      "[Nova] Score moyen:",
      this.ctx.scores.length > 0
        ? (this.ctx.scores.reduce((a, b) => a + b, 0) / this.ctx.scores.length).toFixed(1)
        : "N/A",
    )

    this.transition("ENDING")

    await fetch("/api/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: this.ctx.session_id }),
    }).catch(() => {})

    await fetch("/api/engine/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: this.ctx.session_id }),
    }).catch(() => {})

    return true
  }
}
