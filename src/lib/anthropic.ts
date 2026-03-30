import Anthropic from '@anthropic-ai/sdk'
import type { HealthProfile } from './supabase'

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

// ─── System Prompt ────────────────────────────────────────────────────────────

/**
 * Builds a context-aware system prompt for the AI assistant.
 * Includes the user's health profile data when available so the AI
 * can give personalised, relevant responses.
 */
export function buildSystemPrompt(
  topic?: string | null,
  healthProfile?: HealthProfile | null
): string {
  const lines: string[] = [
    `You are MediSpace AI, a knowledgeable and empathetic medical information assistant.`,
    `Your role is to provide clear, accurate health information to help users understand their conditions, medications, and symptoms.`,
    ``,
    `## Core principles`,
    `- Always recommend consulting a qualified healthcare professional for diagnosis and treatment decisions.`,
    `- Never replace a doctor — you inform, educate, and support, but never diagnose or prescribe.`,
    `- Be compassionate and non-judgmental. Health is personal.`,
    `- If a user describes a medical emergency (chest pain, difficulty breathing, loss of consciousness, etc.), instruct them to call emergency services immediately.`,
    `- Keep responses concise but thorough. Use bullet points and clear headings when helpful.`,
    `- Use plain language. Avoid jargon unless the user clearly has medical knowledge.`,
  ]

  // Topic-specific instructions
  if (topic) {
    lines.push(``, `## Current topic: ${topic}`)
    const topicInstructions: Record<string, string> = {
      'Allergy Checker':
        'Help the user identify potential allergens in medications or foods. Cross-reference ingredients with common allergens and flag any known reactions. Always note that only a professional allergy test is definitive.',
      'Drug Interactions':
        'Analyse the combination of medications the user lists. Highlight any known dangerous interactions, severity levels, and what symptoms to watch for. Remind the user to inform their pharmacist or doctor.',
      'Drug Information Lookup':
        'Provide comprehensive information about the medication: what it treats, how it works, typical dosages, common and serious side effects, contraindications, and storage instructions.',
      'Symptom Analysis':
        'Help the user understand possible causes of their symptoms. Ask clarifying questions about duration, severity, and related symptoms. Always advise seeing a doctor for proper diagnosis.',
      'Emergency Guidance':
        'Provide calm, step-by-step guidance. Prioritise immediate safety. If it is life-threatening, instruct the user to call emergency services right away before giving any other advice.',
      'AI Consultation':
        'Act as a general health assistant. Answer health-related questions thoroughly while maintaining appropriate medical disclaimers.',
    }
    if (topicInstructions[topic]) {
      lines.push(topicInstructions[topic])
    }
  }

  // Health profile context
  if (healthProfile) {
    lines.push(``, `## User health profile (use this to personalise responses)`)

    if (healthProfile.date_of_birth) {
      const age = new Date().getFullYear() - new Date(healthProfile.date_of_birth).getFullYear()
      lines.push(`- Age: approximately ${age} years old`)
    }
    if (healthProfile.gender) lines.push(`- Gender: ${healthProfile.gender}`)
    if (healthProfile.blood_type && healthProfile.blood_type !== 'unknown') {
      lines.push(`- Blood type: ${healthProfile.blood_type}`)
    }
    if (healthProfile.height_cm) lines.push(`- Height: ${healthProfile.height_cm} cm`)
    if (healthProfile.weight_kg) lines.push(`- Weight: ${healthProfile.weight_kg} kg`)

    if (healthProfile.existing_conditions.length > 0 && !healthProfile.existing_conditions.includes('None')) {
      lines.push(`- Existing conditions: ${healthProfile.existing_conditions.join(', ')}`)
    }
    if (healthProfile.allergies.length > 0 && !healthProfile.allergies.includes('None')) {
      lines.push(`- Known allergies: ${healthProfile.allergies.join(', ')}`)
    }
    if (healthProfile.current_medications.length > 0) {
      lines.push(`- Current medications: ${healthProfile.current_medications.join(', ')}`)
    }
    if (healthProfile.smoking_status) {
      lines.push(`- Smoking: ${healthProfile.smoking_status}`)
    }
    if (healthProfile.alcohol_consumption) {
      lines.push(`- Alcohol: ${healthProfile.alcohol_consumption}`)
    }
    if (healthProfile.exercise_frequency) {
      lines.push(`- Activity level: ${healthProfile.exercise_frequency}`)
    }
    if (healthProfile.primary_health_goal) {
      lines.push(`- Primary health goal: ${healthProfile.primary_health_goal}`)
    }

    lines.push(
      ``,
      `When relevant, factor in these details to make your answers more accurate and personal. For example, flag interactions with their listed medications, or note if a condition affects a recommendation.`
    )
  }

  lines.push(
    ``,
    `## Format`,
    `Respond in clear, readable prose. Use markdown for structure (bold, bullets, headings) when it helps clarity. Keep responses focused and actionable.`
  )

  return lines.join('\n')
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Calls the Anthropic API and returns the full text response.
 * history should be the last N messages (up to 20) for context.
 */
export async function chat(
  userMessage: string,
  history: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Anthropic')
  return block.text
}

/**
 * Streams the Anthropic response and calls onDelta for each text chunk.
 * Resolves with the full accumulated text when complete.
 */
export async function chatStream(
  userMessage: string,
  history: ChatMessage[],
  systemPrompt: string,
  onDelta: (chunk: string) => void
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let fullText = ''

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: systemPrompt,
    messages,
  })

  for await (const event of stream) {
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      const chunk = event.delta.text
      fullText += chunk
      onDelta(chunk)
    }
  }

  return fullText
}
