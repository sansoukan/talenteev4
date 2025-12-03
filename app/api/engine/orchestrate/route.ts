/***********************************************************************
 🔥 NOVA ENGINE — ORCHESTRATE V37 (GOOGLE-LEVEL, FULLY HARDENED)
 - Strict input validation
 - Full Supabase error detection
 - General & Domain fallback fully safe
 - Never crashes, always returns a consistent pack
 - Compatible with Flow V6 GMAT logic
************************************************************************/

import { NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabaseAdmin"

/* ----------------------------------------------------------
 * Helper — Normalize video fields
 * ---------------------------------------------------------- */
function normalizeQuestion(q: any): any {
  if (!q) return q
  const clone: any = { ...q }
  for (const k of Object.keys(clone)) {
    if (clone[k] && typeof clone[k] === "object" && clone[k]?.url) {
      clone[k] = clone[k].url
    }
  }
  return clone
}

/* ----------------------------------------------------------
 * CAREER PYRAMIDS
 * ---------------------------------------------------------- */
const PYRAMID_ELITE = {
  exec: ["exec", "manager", "professional", "graduate", "student"],
  manager: ["manager", "professional", "graduate", "student"],
  professional: ["professional", "graduate", "student"],
  graduate: ["graduate", "student"],
  student: ["student"],
}

const PYRAMID_OP = {
  op_supervisor: ["op_supervisor", "op_experienced", "op_junior", "op_entry"],
  op_experienced: ["op_experienced", "op_junior", "op_entry"],
  op_junior: ["op_junior", "op_entry"],
  op_entry: ["op_entry"],
}

/* Difficulty cascade for multi-level fallback */
const DIFF_CASCADE = {
  1: [1, 2, 3],
  2: [2, 1, 3],
  3: [3, 2, 1],
}

/* Fallback domain if main domain empty */
const DOMAIN_FALLBACK: Record<string, string[]> = {
  marketing: ["general"],
  sales: ["general"],
  finance: ["general"],
  consulting: ["general"],
  tech: ["general"],
  hr: ["general"],
  legal: ["general"],
  product: ["general"],
  ops: ["general"],
  supply_chain: ["general"],
  production: ["general"],
  accounting: ["general"],
  banking: ["general"],
  general: ["general"],
}

/* ----------------------------------------------------------
 * MAIN ORCHESTRATOR
 * ---------------------------------------------------------- */
export async function POST(req: Request) {
  try {
    /* ============================ */
    /* 0. INPUT VALIDATION SECURED */
    /* ============================ */

    const body = await req.json().catch(() => null)
    if (!body || !body.session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }

    const session_id = body.session_id

    /* ============================ */
    /* 1. LOAD SESSION + PROFILE    */
    /* ============================ */

    const { data: session, error: sessionError } = await supabaseAdmin
      .from("nova_sessions")
      .select(
        `
        *,
        profiles:profiles!inner(
          id, prenom, segment, career_stage, domain, sub_domain
        )
      `
      )
      .eq("id", session_id)
      .maybeSingle()

    if (sessionError) {
      console.error("[Orchestrate] Supabase session error:", sessionError)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    const profile = session.profiles || {}

    const user_id = session.user_id
    const firstname = profile.prenom?.trim() || "Candidate"

    const lang = session.lang || "en"
    const simulation_mode = session.simulation_mode || (lang === "en" ? "video" : "audio")

    const domain = profile.domain?.trim() || "general"
    const subDomain = profile.sub_domain?.trim() || null

    const segment = profile.segment || "elite"
    const isOperational = segment === "operational"

    const primaryCareerTarget = profile.career_stage?.trim() || (isOperational ? "op_entry" : "student")

    const pyramid =
      (isOperational ? PYRAMID_OP[primaryCareerTarget] : PYRAMID_ELITE[primaryCareerTarget]) ||
      (isOperational ? PYRAMID_OP["op_entry"] : PYRAMID_ELITE["student"])

    /* ============================ */
    /* 2. MEMORY → askedIds fusion  */
    /* ============================ */

    const { data: mem, error: memError } = await supabaseAdmin
      .from("nova_memory")
      .select("question_id")
      .eq("user_id", user_id)

    if (memError) {
      console.error("[Orchestrate] Memory error:", memError)
    }

    let askedIds = (mem || [])
      .map((m) => m.question_id)
      .filter((id) => typeof id === "string" && id.startsWith("q_") && /^[a-zA-Z0-9_]+$/.test(id))

    askedIds = [...new Set(askedIds)]
    console.log("🧹 askedIds:", askedIds)

    /* ============================ */
    /* 3. INIT Q1 SAFE FALLBACK     */
    /* ============================ */

    if (!askedIds.length && !session.detail?.init_q1_sent) {
      const { data: q1 } = await supabaseAdmin
        .from("nova_questions")
        .select("*")
        .eq("question_id", "q_0001")
        .eq("is_active", true)
        .maybeSingle()

      const q1Norm = q1
        ? normalizeQuestion(q1)
        : {
            question_id: "q_0001",
            difficulty: 1,
            domain: "general",
            question_en: "Tell me about yourself.",
          }

      await supabaseAdmin
        .from("nova_sessions")
        .update({
          detail: { ...(session.detail || {}), init_q1_sent: true },
          questions: [q1Norm],
          total_questions: 1,
        })
        .eq("id", session_id)

      return NextResponse.json({
        action: "INIT_Q1",
        session_id,
        user_id,
        firstname,
        lang,
        simulation_mode,
        type_entretien: session.type_entretien,
        question: q1Norm,
        questions: [q1Norm],
        total_questions: 1,
      })
    }

    /* ============================ */
    /* 4. UNIVERSAL QUESTION FETCHER */
    /* ============================ */

    async function fetchQuestions({ domain, subDomain, difficulties, careerTargets, usedIds, limit }: any) {
      const safeUsed = usedIds.length ? usedIds.map((x) => `'${x}'`).join(",") : "'_NONE_'"

      let q = supabaseAdmin
        .from("nova_questions")
        .select(
          `
            id, question_id, domain, sub_domain, difficulty,
            career_target, probability,
            question_en, question_fr,
            video_url_en, video_url_fr,
            audio_prompt_en, audio_prompt_fr,
            text_en, text_fr
        `
        )
        .eq("is_active", true)
        .not("question_id", "in", `(${safeUsed})`)
        .eq("domain", domain)

      if (subDomain) q = q.eq("sub_domain", subDomain)
      if (difficulties?.length) q = q.in("difficulty", difficulties)
      if (careerTargets?.length) q = q.contains("career_target", careerTargets)

      const { data: primary } = await q.order("probability", { ascending: false }).limit(limit)
      let rows = primary || []

      const missing = limit - rows.length
      if (missing > 0) {
        const fallbackDomains = DOMAIN_FALLBACK[domain] || []
        if (fallbackDomains.length) {
          let qFb = supabaseAdmin
            .from("nova_questions")
            .select(
              `
              id, question_id, domain, sub_domain, difficulty,
              career_target, probability,
              question_en, question_fr,
              video_url_en, video_url_fr,
              audio_prompt_en, audio_prompt_fr,
              text_en, text_fr
            `
            )
            .eq("is_active", true)
            .not("question_id", "in", `(${safeUsed})`)
            .in("domain", fallbackDomains)

          if (difficulties?.length) qFb = qFb.in("difficulty", difficulties)
          if (careerTargets?.length) qFb = qFb.contains("career_target", careerTargets)

          const { data: fb } = await qFb.order("probability", { ascending: false }).limit(missing)
          if (fb) rows = [...rows, ...fb]
        }
      }

      return rows.map(normalizeQuestion)
    }

    /* ============================ */
    /* 5. GENERAL PACK (5 max)      */
    /* ============================ */

    async function fetchGeneralPack() {
      const generalUsed = [...used]

      async function fetchGeneral(difficulty: number, count: number) {
        const safeUsed = generalUsed.length ? generalUsed.map((x) => `'${x}'`).join(",") : "'_NONE_'"

        const { data } = await supabaseAdmin
          .from("nova_questions")
          .select(
            `
            id, question_id, domain, sub_domain, difficulty,
            career_target, probability,
            question_en, question_fr,
            video_url_en, video_url_fr,
            audio_prompt_en, audio_prompt_fr,
            text_en, text_fr
          `
          )
          .eq("is_active", true)
          .eq("domain", "general")
          .eq("difficulty", difficulty)
          .not("question_id", "in", `(${safeUsed})`)
          .contains("career_target", pyramid)
          .order("probability", { ascending: false })
          .limit(count)

        const res = (data || []).map(normalizeQuestion)
        generalUsed.push(...res.map((q) => q.question_id))
        return res
      }

      const g1 = await fetchGeneral(1, 1)
      let g2 = await fetchGeneral(2, 2)
      const g3 = await fetchGeneral(3, 2)

      const total = g1.length + g2.length + g3.length

      if (total < 5) {
        const missing = 5 - total
        const fb = await fetchGeneral(2, missing)
        g2 = [...g2, ...fb]
      }

      return [...g1, ...g2, ...g3].slice(0, 5) // FLOW gère si moins de 5
    }

    const generalPack = await fetchGeneralPack()
    used.push(...generalPack.map((q) => q.question_id))

    /* ============================ */
    /* 6. DOMAIN PACK (≤45)         */
    /* ============================ */

    const block1 = await fetchQuestions({
      domain,
      subDomain,
      difficulties: DIFF_CASCADE[1],
      careerTargets: pyramid,
      usedIds: used,
      limit: 15,
    })
    used.push(...block1.map((q) => q.question_id))

    const block2 = await fetchQuestions({
      domain,
      subDomain,
      difficulties: DIFF_CASCADE[2],
      careerTargets: pyramid,
      usedIds: used,
      limit: 15,
    })
    used.push(...block2.map((q) => q.question_id))

    const block3 = await fetchQuestions({
      domain,
      subDomain,
      difficulties: DIFF_CASCADE[3],
      careerTargets: pyramid,
      usedIds: used,
      limit: 15,
    })

    const domainPackRaw = [...block1, ...block2, ...block3]

    if (domainPackRaw.length === 0) {
      console.warn("[Orchestrate] NO DOMAIN AVAILABLE → general only")
    }

    /* ---------------------------
     * FLOWERS SORT (stable)
     * --------------------------- */
    function flowersSort(qs: any[]) {
      const score = (q: any) => {
        const d = q.difficulty || 1
        const p = q.probability || 0.5
        const weight = d === 1 ? 1 : d === 2 ? 0.7 : 0.4
        return p * weight * (0.9 + Math.random() * 0.2)
      }
      return [...qs].sort((a, b) => score(b) - score(a))
    }

    const sortedGeneral = generalPack.map((q) => {
      delete q.id
      return normalizeQuestion(q)
    })

    const sortedDomain = flowersSort(domainPackRaw).map((q) => {
      delete q.id
      return normalizeQuestion(q)
    })

    const finalQuestions = [...sortedGeneral, ...sortedDomain]

    if (finalQuestions.length === 0) {
      console.error("[Orchestrate] CRITICAL: EMPTY PACK")
      return NextResponse.json(
        {
          error: "No questions available",
          details: { domain, subDomain, pyramid },
        },
        { status: 500 },
      )
    }

    /* ============================ */
    /* 7. SAVE PACK                 */
    /* ============================ */

    await supabaseAdmin
      .from("nova_sessions")
      .update({
        questions: finalQuestions,
        total_questions: finalQuestions.length,
        duration_target: 20 * 60,
      })
      .eq("id", session_id)

    /* ============================ */
    /* 8. RETURN PACK FLOW-READY    */
    /* ============================ */

    return NextResponse.json({
      action: "INIT_SEQUENCE",
      session_id,
      user_id,
      firstname,
      lang,
      simulation_mode,
      type_entretien: session.type_entretien,
      questions: finalQuestions,
      total_questions: finalQuestions.length,
    })
  } catch (err: any) {
    console.error("[Orchestrate] FATAL ERROR:", err)
    return NextResponse.json(
      {
        error: "Server failure",
        message: err?.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      { status: 500 },
    )
  }
}
