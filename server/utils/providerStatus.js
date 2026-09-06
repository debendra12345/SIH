function getProviderStatus() {
  const aiProvider = process.env.GROQ_API_KEY
    ? 'groq'
    : process.env.GEMINI_API_KEY
      ? 'gemini'
      : 'none';

  return {
    ai: {
      provider: aiProvider,
      status: aiProvider === 'none' ? 'fallback_only' : 'configured',
      configured: aiProvider !== 'none'
    },
    persistence: {
      mode: 'file_demo',
      status: 'available',
      durable: true
    },
    integrations: {
      abdm: { mode: 'demo', status: 'not_connected' },
      fhir: { mode: 'demo', status: 'local_mapping_only' },
      his: { mode: 'demo', status: 'not_connected' }
    }
  };
}

module.exports = { getProviderStatus };
