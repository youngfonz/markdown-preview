export async function POST(request: Request) {
  // If TTS_PASSCODE is set in the environment, require it as a header.
  // This stops random visitors at fonz.sh/markdown from burning your OpenAI credits.
  const requiredPasscode = process.env.TTS_PASSCODE;
  if (requiredPasscode) {
    const provided = request.headers.get("x-tts-passcode");
    if (provided !== requiredPasscode) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const text: string = (body.text ?? "").toString();
  const voice: string = (body.voice ?? "nova").toString();
  const model: string = (body.model ?? "tts-1").toString();
  const speed: number = Math.max(0.25, Math.min(4, Number(body.speed) || 1));
  const clientKey: string | undefined = body.apiKey;

  const apiKey = process.env.OPENAI_API_KEY || clientKey;
  if (!apiKey) {
    return Response.json(
      { error: "Missing OpenAI API key. Open settings (⚙) and paste your key." },
      { status: 400 }
    );
  }
  if (!text.trim()) {
    return Response.json({ error: "Empty text" }, { status: 400 });
  }

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text.slice(0, 4096),
      response_format: "mp3",
      speed,
    }),
    signal: request.signal,
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return Response.json({ error: err }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
