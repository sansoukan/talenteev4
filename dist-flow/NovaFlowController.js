"use strict";
// ===============================================================
//  NovaFlowController.ts — V7.2 (Google-level)
// ---------------------------------------------------------------
//  Fix les 4 problemes critiques :
//   1) GENERAL dans l'ORDRE orchestrate (pas triees par difficulte)
//   2) Domain GMAT fallback securise pour difficulty manquante
//   3) Fin de pools GENERAL + DOMAIN -> renvoie null proprement
//   4) returnQuestion() garantie payload compatible NovaEngine
// ===============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.NovaFlowController = void 0;
const videoManager_1 = require("@/lib/videoManager");
class NovaFlowController {
    constructor(session_id, lang, mode, firstname) {
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
            maxGeneralQuestions: 5,
            maxDomainQuestions: 20,
            currentDifficulty: 1,
            scores: [],
        };
        console.log("[Nova] FlowController V7.2 initialized", {
            session_id,
            lang,
            mode,
            maxGeneral: 5,
            maxDomain: 20,
            maxTotal: 25,
            fallback: "GENERAL restantes si DOMAIN epuise",
        });
    }
    // -----------------------------------------------------------
    // Transition securisee
    // -----------------------------------------------------------
    transition(next) {
        console.log(`[Nova] STATE: ${this.ctx.state} -> ${next}`);
        this.ctx.state = next;
    }
    // ===========================================================
    // 0. INIT POOLS (GENERAL + DOMAIN) a partir de nextQuestions
    // ===========================================================
    ensurePools() {
        if (this.ctx.poolsInitialized)
            return;
        const src = Array.isArray(this.ctx.nextQuestions) ? this.ctx.nextQuestions : [];
        const general = [];
        const d1 = [];
        const d2 = [];
        const d3 = [];
        for (const q of src) {
            if (!q)
                continue;
            if (q.domain === "general") {
                general.push(q); // V7.2: on garde L'ORDRE orchestre
            }
            else {
                const d = q.difficulty || 1; // securise difficulte
                if (d <= 1)
                    d1.push(q);
                else if (d === 2)
                    d2.push(q);
                else
                    d3.push(q);
            }
        }
        this.ctx.generalPool = general;
        this.ctx.domainPool = { 1: d1, 2: d2, 3: d3 };
        this.ctx.poolsInitialized = true;
        console.log("[Nova] Pools ready (NO SORT):", {
            general: general.length,
            d1: d1.length,
            d2: d2.length,
            d3: d3.length,
            total: general.length + d1.length + d2.length + d3.length,
        });
    }
    // ===========================================================
    // 1. INTRO FLOW
    // ===========================================================
    async getIntro1() {
        this.transition("INTRO_1");
        console.log("[Nova] Playing INTRO_1");
        return await (0, videoManager_1.getSystemVideo)(`intro_${this.ctx.lang}_1`, this.ctx.lang);
    }
    async getIntro2() {
        this.transition("INTRO_2");
        console.log("[Nova] Playing INTRO_2");
        return await (0, videoManager_1.getSystemVideo)(`intro_${this.ctx.lang}_2`, this.ctx.lang);
    }
    // ===========================================================
    // 2. Q1 — appelle orchestrate si besoin
    // ===========================================================
    async fetchQ1() {
        console.log("[Nova] fetchQ1() called");
        // CAS 1 - Q1 deja injectee
        if (this.ctx.currentQuestion && (!this.ctx.nextQuestions || this.ctx.nextQuestions.length === 0)) {
            console.log("[Nova] Q1 already injected from frontend");
            this.ctx.questionCount = 1;
            this.ctx.generalQuestionsCount = 1;
            return this._returnQuestion(this.ctx.currentQuestion, "Q1");
        }
        // CAS 2 - Q1 + pool deja envoyes par orchestrate
        if (this.ctx.currentQuestion && Array.isArray(this.ctx.nextQuestions)) {
            console.log("[Nova] Q1 + nextQuestions already set");
            this.ctx.questionCount = 1;
            this.ctx.generalQuestionsCount = 1;
            return this._returnQuestion(this.ctx.currentQuestion, "Q1");
        }
        // CAS 3 - Fetch orchestrate
        console.log("[Nova] Calling orchestrate API...");
        const res = await fetch("/api/engine/orchestrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: this.ctx.session_id }),
        }).catch((e) => {
            console.error("[Nova] Orchestrate call failed:", e);
            return null;
        });
        if (!res)
            return null;
        let json = null;
        try {
            json = await res.json();
        }
        catch (e) {
            console.error("[Nova] Orchestrate JSON parse error:", e);
            return null;
        }
        if (!json || (!json.question && !json.questions)) {
            console.error("[Nova] Orchestrate returned invalid payload:", json);
            return null;
        }
        const q1 = json.question || json.questions[0] || null;
        if (!q1)
            return null;
        this.ctx.currentQuestion = q1;
        // PATCH IMPORTANT: NE PAS SHIFT()
        // On conserve *toutes* les questions renvoyees pour la GMAT sequence
        this.ctx.nextQuestions = Array.isArray(json.questions) ? [...json.questions] : [];
        this.ctx.poolsInitialized = false;
        this.ctx.generalQuestionsCount = 1;
        this.ctx.questionCount = 1;
        console.log("[Nova] Q1 received:", q1.question_id);
        console.log("[Nova] Total nextQuestions:", this.ctx.nextQuestions.length);
        return this._returnQuestion(q1, "Q1");
    }
    // ===========================================================
    // 3. RUNNING QUESTIONS — GENERAL puis DOMAIN avec fallback
    // ===========================================================
    async fetchNextQuestion() {
        const MAX = this.ctx.maxGeneralQuestions + this.ctx.maxDomainQuestions; // 25
        console.log("[Nova] ─────────────────────────────────────");
        console.log("[Nova] fetchNextQuestion() called");
        console.log("[Nova] questionCount:", this.ctx.questionCount, "/", MAX);
        if (this.ctx.questionCount >= MAX) {
            console.log("[Nova] LIMIT 25 reached -> END");
            return null;
        }
        // Initialiser les pools
        this.ensurePools();
        const generalLeft = this.ctx.generalPool.length;
        const domainLeft = this.ctx.domainPool[1].length + this.ctx.domainPool[2].length + this.ctx.domainPool[3].length;
        console.log("[Nova] Pools: GENERAL=", generalLeft, "| DOMAIN=", domainLeft);
        if (generalLeft === 0 && domainLeft === 0) {
            console.log("[Nova] ALL POOLS EMPTY -> END SESSION");
            return null;
        }
        let next = null;
        // GENERAL obligatoire Q1-Q5
        if (this.ctx.generalQuestionsCount < this.ctx.maxGeneralQuestions && generalLeft > 0) {
            next = this._pickNextGeneral();
            if (next)
                this.ctx.generalQuestionsCount++;
        }
        // DOMAIN GMAT
        if (!next && domainLeft > 0) {
            next = this._pickNextDomainGMAT();
        }
        // FALLBACK GENERAL si DOMAIN vide
        if (!next && generalLeft > 0) {
            console.log("[Nova] FALLBACK using remaining GENERAL");
            next = this._pickNextGeneral();
        }
        if (!next) {
            console.log("[Nova] fetchNextQuestion(): NOTHING LEFT -> END");
            return null;
        }
        this.ctx.currentQuestion = next;
        this.ctx.questionCount++;
        console.log("[Nova] QUESTION", this.ctx.questionCount, ":", next.question_id, "| diff:", next.difficulty);
        return this._returnQuestion(next, "RUN");
    }
    // ===========================================================
    // 4. FEEDBACK + ajustement GMAT (DOMAIN uniquement)
    // ===========================================================
    async sendFeedback(transcript) {
        if (!this.ctx.currentQuestion)
            return null;
        const q = this.ctx.currentQuestion;
        const lang = this.ctx.lang;
        console.log("[Nova] sendFeedback() pour question:", q.question_id);
        console.log("[Nova] Transcript length:", transcript?.length || 0);
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
            console.error("[Nova] /feedback-question error:", e);
            return null;
        });
        if (!res)
            return null;
        let json = null;
        try {
            json = await res.json();
        }
        catch (e) {
            console.error("[Nova] /feedback-question JSON error:", e);
            return null;
        }
        const score = json?.score_auto ?? 0;
        console.log("[Nova] Feedback recu - score_auto:", score);
        // Ajuster difficulte SEULEMENT si phase DOMAIN (apres Q5)
        if (this.ctx.generalQuestionsCount >= this.ctx.maxGeneralQuestions &&
            this.ctx.currentQuestion?.domain !== "general") {
            this._adjustDifficultyGMAT(score);
        }
        else {
            console.log("[Nova] Phase GENERAL ou question GENERAL fallback - pas d'ajustement");
        }
        this.transition("FEEDBACK_IDLE");
        return {
            type: "idle_feedback",
            idle_url: await this.getIdleListen(),
            feedback: json,
        };
    }
    // ===========================================================
    // HELPERS — GENERAL & DOMAIN
    // ===========================================================
    // GENERAL : prend la question de difficulte la plus basse dispo
    _pickNextGeneral() {
        if (!this.ctx.generalPool.length)
            return null;
        const q = this.ctx.generalPool.shift();
        this.ctx.currentQuestion = q;
        return q;
    }
    // GMAT : ajuster la difficulte pour DOMAIN
    _adjustDifficultyGMAT(score) {
        this.ctx.scores.push(score);
        const old = this.ctx.currentDifficulty;
        if (score >= 65) {
            if (this.ctx.currentDifficulty < 3)
                this.ctx.currentDifficulty++;
            console.log("[Nova] GMAT: BONNE (", score, ") diff:", old, "->", this.ctx.currentDifficulty);
        }
        else if (score < 50) {
            if (this.ctx.currentDifficulty > 1)
                this.ctx.currentDifficulty--;
            console.log("[Nova] GMAT: MAUVAISE (", score, ") diff:", old, "->", this.ctx.currentDifficulty);
        }
        else {
            console.log("[Nova] GMAT: MOYENNE (", score, "), diff reste:", this.ctx.currentDifficulty);
        }
    }
    // DOMAIN : selection avec fallback 1->2->3, 2->1->3, 3->2->1
    _pickNextDomainGMAT() {
        const dp = this.ctx.domainPool;
        const tryLevel = (lvl) => {
            if (dp[lvl].length > 0) {
                const q = dp[lvl].shift();
                q.difficulty = q.difficulty || lvl; // V7.2: fallback securite
                this.ctx.currentDifficulty = lvl;
                this.ctx.currentQuestion = q;
                return q;
            }
            return null;
        };
        // V7.2: fallback complet base sur difficulte actuelle
        const lvl = this.ctx.currentDifficulty;
        let q = null;
        if (lvl === 1) {
            q = tryLevel(1) || tryLevel(2) || tryLevel(3);
        }
        else if (lvl === 2) {
            q = tryLevel(2) || tryLevel(1) || tryLevel(3);
        }
        else {
            q = tryLevel(3) || tryLevel(2) || tryLevel(1);
        }
        if (!q)
            console.log("[Nova] GMAT DOMAIN exhausted");
        return q;
    }
    _returnQuestion(q, phase) {
        const videoUrl = this.ctx.lang === "fr" ? q.video_url_fr || q.video_url_en : q.video_url_en || q.video_url_fr;
        const finalUrl = videoUrl || "https://qpnalviccuopdwfscoli.supabase.co/storage/v1/object/public/videos/system/question_missing.mp4";
        console.log("[Nova] Emit question:", {
            phase,
            id: q.question_id,
            domain: q.domain,
            difficulty: q.difficulty,
            url: finalUrl,
        });
        if (this.ctx.mode === "audio") {
            this.transition(phase === "Q1" ? "Q1_AUDIO" : "RUN_AUDIO");
            return { type: "audio", question: q };
        }
        this.transition(phase === "Q1" ? "Q1_VIDEO" : "RUN_VIDEO");
        // V7.2: url OBLIGATOIRE pour NovaEngine
        return {
            type: "video",
            url: finalUrl,
            question: q,
        };
    }
    // ===========================================================
    // 5. IDLE VIDEOS
    // ===========================================================
    async getIdleListen() {
        return await (0, videoManager_1.getSystemVideo)("idle_listen", this.ctx.lang);
    }
    async getIdleSmile() {
        try {
            return await (0, videoManager_1.getSystemVideo)("idle_smile", this.ctx.lang);
        }
        catch {
            return this.getIdleListen();
        }
    }
    async getIdleAlt() {
        try {
            return await (0, videoManager_1.getSystemVideo)("listen_idle_01", this.ctx.lang);
        }
        catch {
            return this.getIdleListen();
        }
    }
    // ===========================================================
    // 6. RELANCE
    // ===========================================================
    async getRelance() {
        const lang = this.ctx.lang || "en";
        console.log("[Nova] getRelance() - lang:", lang);
        try {
            return await (0, videoManager_1.getSystemVideo)("clarify_start", lang);
        }
        catch { }
        try {
            return await (0, videoManager_1.getSystemVideo)(`clarify_${lang}`, lang);
        }
        catch { }
        return await this.getIdleSmile();
    }
    // ===========================================================
    // 7. SESSION END
    // ===========================================================
    async endSession() {
        console.log("[Nova] =========================================");
        console.log("[Nova] endSession() called");
        console.log("[Nova] ─────────────────────────────────────");
        console.log("[Nova] Total questions posees:", this.ctx.questionCount);
        console.log("[Nova] Questions GENERAL:", this.ctx.generalQuestionsCount);
        console.log("[Nova] Questions DOMAIN:", this.ctx.questionCount - this.ctx.generalQuestionsCount);
        console.log("[Nova] Scores:", this.ctx.scores);
        const avgScore = this.ctx.scores.length > 0
            ? (this.ctx.scores.reduce((a, b) => a + b, 0) / this.ctx.scores.length).toFixed(1)
            : "N/A";
        console.log("[Nova] Score moyen:", avgScore);
        console.log("[Nova] =========================================");
        this.transition("ENDING");
        try {
            await fetch("/api/session/end", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: this.ctx.session_id }),
            });
            console.log("[Nova] /api/session/end OK");
        }
        catch (e) {
            console.error("[Nova] /api/session/end FAILED:", e);
        }
        try {
            await fetch("/api/engine/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: this.ctx.session_id }),
            });
            console.log("[Nova] /api/engine/complete OK");
        }
        catch (e) {
            console.error("[Nova] /api/engine/complete FAILED:", e);
        }
        return true;
    }
}
exports.NovaFlowController = NovaFlowController;
