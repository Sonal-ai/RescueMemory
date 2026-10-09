export function dedupeStrings(values) {
  const seen = new Set();
  return (values || []).filter(value => {
    if (!value) return false;
    const normalized = String(value).trim().toLowerCase().replace(/^[•\-*\d.\s]+/, '').replace(/[^a-z0-9]/g, '');
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized); return true;
  }).map(value => String(value).trim());
}

export function formatGuidanceCards(cards, metadata = {}) {
  const mapped = cards.map(card => ({ ...card,
    steps: dedupeStrings(card.instructions?.length ? card.instructions : (card.summary || '')
      .split(/(?<=[.?!;])\s+/).map(text => text.trim()).filter(text => text.length > 8)),
    instructions: card.instructions || [], warnings: dedupeStrings(card.warnings || []),
  }));
  const primary = mapped[0];
  let text;
  if (primary) {
    text = `### Reference Protocol: ${primary.title}\n\n`;
    if (primary.summary && (primary.instructions.length > 0 || primary.steps.length <= 1)) text += `${primary.summary}\n\n`;
    if (primary.steps.length > 1 || primary.instructions.length) {
      text += '**Action Steps:**\n' + primary.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') + '\n\n';
    }
    if (primary.warnings.length) text += '**Critical Warnings:**\n' + primary.warnings.map(warning => `- ${warning}`).join('\n') + '\n\n';
    if (primary.source) text += `**Source:** ${primary.source}\n\n`;
    if (mapped.length > 1) text += '**Related Reference Protocols:**\n' + mapped.slice(1, 4).map(card => `- ${card.title}`).join('\n');
  } else {
    text = '### No Matching Local Guidance\n\nNo stored protocol matched this question. Try describing the injury or hazard more specifically. You can use Emergency SOS to request help.';
  }
  return { ...metadata, source_cards: mapped, text,
    warnings: dedupeStrings(mapped.flatMap(card => card.warnings)).slice(0, 3), on_device: true };
}
