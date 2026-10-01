import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { prompt, model = "flux-schnell" } = await req.json();

  if (!prompt) {
    return NextResponse.json({ error: "prompt is required", code: "prompt_required" }, { status: 400 });
  }

  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    return NextResponse.json(
      { error: "REPLICATE_API_TOKEN not set" },
      { status: 500 }
    );
  }

  const modelMap: Record<string, string> = {
    "flux-schnell": "black-forest-labs/flux-schnell",
    "flux-dev": "black-forest-labs/flux-dev",
    "sdxl": "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e9ab983064d4550b70c1f15e",
  };

  const version = modelMap[model] || modelMap["flux-schnell"];

  // Create prediction
  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify({
      model: version.includes(":") ? undefined : version,
      version: version.includes(":") ? version.split(":")[1] : undefined,
      input: { prompt, num_outputs: 1 },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    return NextResponse.json({ error: err, code: "generation_failed" }, { status: 500 });
  }

  const prediction = await createRes.json();

  // If completed immediately (Prefer: wait)
  if (prediction.status === "succeeded") {
    const output = Array.isArray(prediction.output)
      ? prediction.output[0]
      : prediction.output;
    return NextResponse.json({ imageUrl: output });
  }

  // Poll until done
  const id = prediction.id;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await poll.json();
    if (data.status === "succeeded") {
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      return NextResponse.json({ imageUrl: output });
    }
    if (data.status === "failed") {
      return NextResponse.json({ error: data.error, code: "generation_failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Timed out", code: "generation_timed_out" }, { status: 504 });
}
