/***********************************************************************
 NOVA ENGINE — ORCHESTRATE V40 (GOOGLE-LEVEL, FULLY HARDENED)
 ----------------------------------------------------------------------
 - INPUT SAFE : JSON valide, pas d'inner join cassant
 - MEMORY SAFE : askedIds nettoyes et types
 - GENERAL PACK : jusqu'a 15 questions (3x diff1, 6x diff2, 6x diff3) + fallback
 - DOMAIN PACK : jusqu'a 45 questions par domaine, avec fallback de domaine
 - CAREER TARGET : filtre .overlaps() safe, ignore si colonne non-array
 - NEVER EMPTY : si aucune question trouvee → fallback q_fallback_001
 - COMPATIBLE : Flow V7.1 (GENERAL + DOMAIN GMAT), VideoPlayer double-buffer
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
const PYRAMID_ELITE: Record<string, string[]> = {
  exec: ["exec", "manager", "professional", "graduate", "student"],
  manager: ["manager", "professional", "graduate", "student"],
  professional: ["professional", "graduate", "student"],
  graduate: ["graduate", "student"],
  student: ["student"],
}

const PYRAMID_OP: Record<string, string[]> = {
  op_supervisor: ["op_supervisor", "op_experienced", "op_junior", "op_entry"],
  op_experienced: ["op_experienced", "op_junior", "op_entry"],
  op_junior: ["op_junior", "op_entry"],
  op_entry: ["op_entry"],
}

/* Difficulty cascade for DOMAIN */
const DIFF_CASCADE: Record<number, number[]> = {
  1: [1, 2, 3],
  2: [2, 1, 3],
  3: [3, 2, 1],
}

/* Fallback domain if main domain empty/incomplete */
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
    /* 0. INPUT VALIDATION         */
    /* ============================ */
    const body = await req.json().catch(() => null)
    console.log("📥 [ORCH-V40] Requête reçue avec payload:", body)

    if (!body || !body.session_id) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 })
    }
    const session_id = body.session_id as string

    /* ============================ */
    /* 1. LOAD SESSION + PROFILE    */
    /*    LEFT JOIN (pas !inner)    */
    /* ============================ */
    const { data: session, error: sessionError } = await supabaseAdmin
      .from("nova_sessions")
      .select(
        `
        *,
        profiles:profiles(
          id, prenom, segment, career_stage, domain, sub_domain
        )
      `,
      )
      .eq("id", session_id)
      .maybeSingle()

    if (sessionError) {
      console.error("[Orchestrate/V40] Supabase session error:", sessionError)
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    if (!session) {
      console.error("[Orchestrate/V40] Session not found:", session_id)
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    console.log("📡 [ORCH-V40] Session chargée:", {
      id: session?.id,
      type_entretien: session?.type_entretien,
      lang: session?.lang,
      simulation_mode: session?.simulation_mode,
      profile_exists: !!session?.profiles,
    })

    const profile = session.profiles || {}

    const user_id = session.user_id
    const firstname = (profile.prenom || "").trim() || "Candidate"

    const lang = session.lang || "en"
    const simulation_mode = session.simulation_mode || (lang === "en" ? "video" : "audio")

    const domain = (profile.domain || "").trim() || "general"
    const rawSub = profile.sub_domain
    const subDomain = rawSub && typeof rawSub === "string" && rawSub.trim() !== "" ? rawSub.trim() : null

    const segment = profile.segment || "elite"
    const isOperational = segment === "operational"
    const defaultCareer = isOperational ? "op_entry" : "student"
    const primaryCareerTarget = (profile.career_stage || "").trim() || defaultCareer

    const pyramid =
      (isOperational ? PYRAMID_OP[primaryCareerTarget] : PYRAMID_ELITE[primaryCareerTarget]) ||
      (isOperational ? PYRAMID_OP["op_entry"] : PYRAMID_ELITE["student"])

    console.log("👤 [ORCH-V40] Profil détecté:", {
      prenom: profile?.prenom,
      segment: profile?.segment,
      career_stage: profile?.career_stage,
      domain: profile?.domain,
      subDomain: profile?.sub_domain,
    })
    console.log("🎯 [ORCH-V40] career_target pyramid:", pyramid)

    /* ============================ */
    /* 2. MEMORY → askedIds fusion  */
    /* ============================ */
    const { data: mem, error: memError } = await supabaseAdmin
      .from("nova_memory")
      .select("question_id")
      .eq("user_id", user_id)

    if (memError) {
      console.warn("[Orchestrate/V40] Memory read error:", memError)
    }

    console.log("🧠 [ORCH-V40] Memory brute:", mem)

    let askedIds =
      (mem || [])
        .map((m) => m.question_id)
        .filter((id: any) => typeof id === "string" && id.startsWith("q_") && /^[a-zA-Z0-9_]+$/.test(id)) || []

    askedIds = [...new Set(askedIds)]
    console.log("🧹 [ORCH-V40] askedIds filtrés:", askedIds)

    /* ============================ */
    /* 3. INIT_Q1 SAFE FALLBACK     */
    /* ============================ */
    if (!askedIds.length && !session.detail?.init_q1_sent) {
      console.log("🚀 [ORCH-V40] INIT_Q1 déclenché")

      const { data: q1, error: q1Error } = await supabaseAdmin
        .from("nova_questions")
        .select("*")
        .eq("question_id", "q_0001")
        .eq("is_active", true)
        .maybeSingle()

      if (q1Error) {
        console.error("[Orchestrate/V40] Q1 fetch error:", q1Error)
      }

      const q1Norm = q1
        ? normalizeQuestion(q1)
        : {
            question_id: "q_0001",
            difficulty: 1,
            domain: "general",
            question_en: "Tell me about yourself.",
            video_url_en: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/system/intro_en_1.mp4`,
          }

      console.log("🎬 [ORCH-V40] INIT_Q1 question sélectionnée:", q1Norm)

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
    /* 4. SAFE usedIds              */
    /* ============================ */
    const used: string[] = [...askedIds]

    /* ============================ */
    /* 5. GENERAL PACK (<= 15)      */
    /*    cible 3/6/6 par niveau    */
    /* ============================ */

    async function fetchGeneral15(): Promise<any[]> {
      console.log("━━━━━━━━━━━━━━━━━━━━━━")
      console.log("📦 [ORCH-V40] Génération GENERAL PACK")
      console.log("━━━━━━━━━━━━━━━━━━━━━━")

      const generalUsed: string[] = [...used]
      const targetPerDiff: Record<number, number> = { 1: 3, 2: 6, 3: 6 }
      const bucket: Record<number, any[]> = { 1: [], 2: [], 3: [] }

      async function fetchGeneralByDiff(diff: number, count: number): Promise<any[]> {
        if (count <= 0) return []

        console.log(`🔍 [GENERAL] Fetch diff=${diff} target=${count}`)

        const safeUsed = generalUsed.length ? generalUsed : ["__none__"]

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
          `,
          )
          .eq("is_active", true)
          .eq("domain", "general")
          .eq("difficulty", diff)
          .not("question_id", "in", `(${safeUsed.map((id) => `'${id}'`).join(",")})`)

        // Filtre career_target safe (ARRAY only)
        if (Array.isArray(pyramid) && pyramid.length > 0) {
          q = q.overlaps("career_target", pyramid as any)
        }

        const { data, error } = await q.order("probability", { ascending: false }).limit(count)

        if (error) {
          console.warn("[Orchestrate/V40] GENERAL diff", diff, "error:", error)
          // Retry sans filtre career_target
          const { data: retry } = await supabaseAdmin
            .from("nova_questions")
            .select(
              `
              id, question_id, domain, sub_domain, difficulty,
              career_target, probability,
              question_en, question_fr,
              video_url_en, video_url_fr,
              audio_prompt_en, audio_prompt_fr,
              text_en, text_fr
            `,
            )
            .eq("is_active", true)
            .eq("domain", "general")
            .eq("difficulty", diff)
            .not("question_id", "in", `(${safeUsed.map((id) => `'${id}'`).join(",")})`)
            .order("probability", { ascending: false })
            .limit(count)
          const rows = (retry || []).map(normalizeQuestion)
          generalUsed.push(...rows.map((q) => q.question_id))
          return rows
        }

        const rows = (data || []).map(normalizeQuestion)
        generalUsed.push(...rows.map((q) => q.question_id))
        return rows
      }

      // 1) Cible par niveau
      bucket[1] = await fetchGeneralByDiff(1, targetPerDiff[1])
      bucket[2] = await fetchGeneralByDiff(2, targetPerDiff[2])
      bucket[3] = await fetchGeneralByDiff(3, targetPerDiff[3])

      console.log("📊 [GENERAL] Résultats:", {
        lvl1: bucket[1].length,
        lvl2: bucket[2].length,
        lvl3: bucket[3].length,
      })

      let allGeneral = [...bucket[1], ...bucket[2], ...bucket[3]]

      console.log("📦 [GENERAL] total avant fallback:", allGeneral.length)

      // 2) Si <15, on complete avec GENERAL tous niveaux
      if (allGeneral.length < 15) {
        const missing = 15 - allGeneral.length
        console.log("📦 [GENERAL] fallback missing:", missing)

        const safeUsed = generalUsed.length ? generalUsed : ["__none__"]

        let qExtra = supabaseAdmin
          .from("nova_questions")
          .select(
            `
            id, question_id, domain, sub_domain, difficulty,
            career_target, probability,
            question_en, question_fr,
            video_url_en, video_url_fr,
            audio_prompt_en, audio_prompt_fr,
            text_en, text_fr
          `,
          )
          .eq("is_active", true)
          .eq("domain", "general")
          .not("question_id", "in", `(${safeUsed.map((id) => `'${id}'`).join(",")})`)

        if (Array.isArray(pyramid) && pyramid.length > 0) {
          qExtra = qExtra.overlaps("career_target", pyramid as any)
        }

        const { data: extra, error: extraError } = await qExtra
          .order("probability", { ascending: false })
          .limit(missing)

        if (extraError) {
          console.warn("[Orchestrate/V40] GENERAL extra error:", extraError)
        } else if (extra?.length) {
          const extraNorm = extra.map(normalizeQuestion)
          allGeneral = [...allGeneral, ...extraNorm]
          generalUsed.push(...extraNorm.map((q) => q.question_id))
        }
      }

      // 3) Tri par difficulte croissante (Flow posera d'abord les plus faciles)
      allGeneral.sort((a, b) => (a.difficulty || 1) - (b.difficulty || 1))

      console.log("📦 [GENERAL] FINAL:", allGeneral.length)
      return allGeneral.slice(0, 15)
    }

    const generalPack = await fetchGeneral15()
    used.push(...generalPack.map((q) => q.question_id))

    /* ============================ */
    /* 6. DOMAIN PACK (<=45)         */
    /* ============================ */
    console.log(`━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`📦 [ORCH-V40] Génération DOMAIN PACK`, { domain, subDomain })
    console.log(`━━━━━━━━━━━━━━━━━━━━━━`)

    async function fetchDomainBlock(level: number, count: number): Promise<any[]> {
      const difficulties = DIFF_CASCADE[level]
      console.log(`🔍 [DOMAIN] Fetch diff=${level}, cascade=${difficulties}`)
      return fetchDomainQuestions({
        domain,
        subDomain,
        difficulties,
        careerTargets: pyramid,
        usedIds: used,
        limit: count,
      })
    }

    async function fetchDomainQuestions({
      domain,
      subDomain,
      difficulties,
      careerTargets,
      usedIds,
      limit,
    }: {
      domain: string
      subDomain: string | null
      difficulties: number[]
      careerTargets: string[]
      usedIds: string[]
      limit: number
    }): Promise<any[]> {
      const safeUsed = usedIds.length ? usedIds.map((id) => `'${id}'`).join(",") : "'__none__'"

      let base = supabaseAdmin
        .from("nova_questions")
        .select(
          `
          id, question_id, domain, sub_domain, difficulty,
          career_target, probability,
          question_en, question_fr,
          video_url_en, video_url_fr,
          audio_prompt_en, audio_prompt_fr,
          text_en, text_fr
        `,
        )
        .eq("is_active", true)
        .not("question_id", "in", `(${safeUsed})`)
        .eq("domain", domain)

      if (subDomain) base = base.eq("sub_domain", subDomain)
      if (difficulties?.length) base = base.in("difficulty", difficulties)

      // Essai avec filtre career_target safe
      let rows: any[] = []
      let q = base
      if (Array.isArray(careerTargets) && careerTargets.length > 0) {
        q = q.overlaps("career_target", careerTargets as any)
      }

      let { data, error } = await q.order("probability", { ascending: false }).limit(limit)

      if (error) {
        console.warn("[Orchestrate/V40] DOMAIN primary error:", error)
        // Retry sans filtre career_target
        const { data: retryData, error: retryError } = await base
          .order("probability", { ascending: false })
          .limit(limit)
        data = retryData
        error = retryError
        if (error) {
          console.error("[Orchestrate/V40] DOMAIN retry error:", error)
          return []
        }
      }

      rows = data || []

      console.log("📦 [DOMAIN] total avant fallback:", rows.length)

      const missing = limit - rows.length
      if (missing > 0) {
        const fallbackDomains = DOMAIN_FALLBACK[domain] || []
        console.log("📦 [DOMAIN] fallback domains utilisés:", fallbackDomains)

        if (fallbackDomains.length > 0) {
          const fbSafeUsed = [...usedIds, ...rows.map((r) => r.question_id)]
          const fbUsedStr = fbSafeUsed.length ? fbSafeUsed.map((id) => `'${id}'`).join(",") : "'__none__'"

          let fb = supabaseAdmin
            .from("nova_questions")
            .select(
              `
              id, question_id, domain, sub_domain, difficulty,
              career_target, probability,
              question_en, question_fr,
              video_url_en, video_url_fr,
              audio_prompt_en, audio_prompt_fr,
              text_en, text_fr
            `,
            )
            .eq("is_active", true)
            .not("question_id", "in", `(${fbUsedStr})`)
            .in("domain", fallbackDomains)

          if (difficulties?.length) fb = fb.in("difficulty", difficulties)
          if (Array.isArray(careerTargets) && careerTargets.length > 0) {
            fb = fb.overlaps("career_target", careerTargets as any)
          }

          const { data: fbRows, error: fbError } = await fb.order("probability", { ascending: false }).limit(missing)

          if (fbError) {
            console.warn("[Orchestrate/V40] DOMAIN fallback error:", fbError)
          } else if (fbRows?.length) {
            rows = [...rows, ...fbRows]
          }
        }
      }

      return rows.map(normalizeQuestion)
    }

    const block1 = await fetchDomainBlock(1, 15)
    used.push(...block1.map((q) => q.question_id))

    const block2 = await fetchDomainBlock(2, 15)
    used.push(...block2.map((q) => q.question_id))

    const block3 = await fetchDomainBlock(3, 15)
    used.push(...block3.map((q) => q.question_id))

    const domainPackRaw = [...block1, ...block2, ...block3]

    console.log("[DOMAIN] Résultats par niveau:", {
      block1: block1.length,
      block2: block2.length,
      block3: block3.length,
    })
    console.log("📦 [DOMAIN] FINAL:", domainPackRaw.length)

    /* ============================ */
    /* 7. NEVER EMPTY PACK          */
    /* ============================ */
    const sortedGeneral = generalPack.map((q) => {
      delete (q as any).id
      return normalizeQuestion(q)
    })

    const sortedDomain = domainPackRaw.map((q) => {
      delete (q as any).id
      return normalizeQuestion(q)
    })

    let finalQuestions = [...sortedGeneral, ...sortedDomain]

    if (finalQuestions.length === 0) {
      console.error("❌ [ORCH-V40] PACK VIDE — fallback question unique déclenché")

      const fallbackQuestion = {
        question_id: "q_fallback_001",
        difficulty: 1,
        domain: "general",
        question_en: "Tell me about yourself.",
        video_url_en: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/system/intro_en_1.mp4`,
      }

      finalQuestions = [fallbackQuestion]
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━")
    console.log("📦 [ORCH-V40] PACK FINAL", {
      general: sortedGeneral.length,
      domain: sortedDomain.length,
      total: finalQuestions.length,
    })
    console.log("━━━━━━━━━━━━━━━━━━━━━━")

    /* ============================ */
    /* 8. SAVE PACK INTO SESSION    */
    /* ============================ */
    await supabaseAdmin
      .from("nova_sessions")
      .update({
        questions: finalQuestions,
        total_questions: finalQuestions.length,
        duration_target: 20 * 60, // 20 min
      })
      .eq("id", session_id)

    /* ============================ */
    /* 9. RETURN PACK               */
    /* ============================ */
    console.log("📤 [ORCH-V40] Payload envoyé à NovaEngine:", {
      total_questions: finalQuestions.length,
      first_question: finalQuestions[0]?.question_id,
    })

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
    console.error("[Orchestrate/V40] FATAL Error:", err)
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
