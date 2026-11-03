import { register } from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';

register('./ts-loader.mjs', import.meta.url);

const { resolveSafeOrigin, resolveSafeNextPath, resolveOptionalHttpUrl } = await import(
  '../src/lib/supabase/origin.ts'
);
const {
  compileStepInstruction,
  escapePostgrestIlike,
  isPublicIpAddress,
  normalizeFinalCaptions,
  normalizeRunStepOutputs,
  parseBoundedImageDataUrl,
  parseFiveCaptions,
  slugifyChainName,
  tokenizeTemplateVariables,
  validateChainInput,
  validateExternalImageUrl,
  validateStepInput,
} = await import('../src/lib/chains/validation.ts');
const {
  buildMultimodalStepHttpRequest,
  extractStepTextAndUsage,
  listSelectableChainModels,
  resolveSelectedChainModel,
} = await import('../src/lib/chains/multimodal-protocols.ts');
const { SAMPLE_SCENES, getSampleSceneById } = await import(
  '../src/lib/chains/sample-scenes.ts'
);

test('resolveSafeOrigin pins http on loopback and https on non-loopback while blocking spoofed headers', () => {
  const localReq = new Request('http://localhost:3002/auth/signin', {
    headers: {
      host: '127.0.0.1:3002',
      'x-forwarded-host': 'evil.example.com',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(resolveSafeOrigin(localReq, {}), 'http://127.0.0.1:3002');

  const prodReq = new Request('http://prompt-chains.vercel.app/auth/callback', {
    headers: { 'x-forwarded-host': 'attacker.invalid' },
  });
  assert.equal(resolveSafeOrigin(prodReq, {}), 'https://prompt-chains.vercel.app');
  assert.equal(
    resolveSafeNextPath('//evil.example.com/steal', 'https://prompt-chains.vercel.app'),
    '/'
  );
  assert.equal(
    resolveSafeNextPath('/\\evil.example.com', 'https://prompt-chains.vercel.app'),
    '/'
  );
  assert.equal(
    resolveSafeNextPath('/?chain=visual-image-to-5-captions', 'https://prompt-chains.vercel.app'),
    '/?chain=visual-image-to-5-captions'
  );
  assert.equal(resolveOptionalHttpUrl('javascript:alert(1)'), null);
  assert.equal(resolveOptionalHttpUrl('http://localhost:3000'), 'http://localhost:3000/');
});

test('validateChainInput, validateStepInput, slugifyChainName, and escapePostgrestIlike enforce strict bounds', () => {
  assert.equal(slugifyChainName('  Visual Deadpan Captioner!! '), 'visual-deadpan-captioner');
  assert.equal(escapePostgrestIlike('a_b%c\\d@columbia.edu'), 'a\\_b\\%c\\\\d@columbia.edu');

  const chain = validateChainInput({
    name: 'Visual Roast Studio',
    persona_style: 'Sharp observational comedy writer.',
    mix_weight: 25,
  });
  assert.equal(chain.slug, 'visual-roast-studio');
  assert.equal(chain.mix_weight, 25);
  assert.equal(chain.is_active, true);

  assert.throws(
    () => validateChainInput({ name: 'X', persona_style: 'Valid persona', mix_weight: 10 }),
    /Chain name/
  );
  assert.throws(
    () => validateChainInput({ name: 'Valid Name', persona_style: 'Valid persona', mix_weight: 140 }),
    /Traffic weight/
  );

  const step = validateStepInput({
    step_name: 'Describe Scene',
    step_role: 'vision_analysis',
    instruction_template: 'Inspect {{input}} and summarize every visual detail.',
    output_field: 'image_description',
  });
  assert.equal(step.step_role, 'vision_analysis');
  assert.equal(step.output_field, 'image_description');
});

test('compileStepInstruction performs single-pass variable substitution and auto-appends omitted upstream context', () => {
  const step1 = compileStepInstruction({
    personaStyle: 'Deadpan visual comic.',
    stepOrder: 1,
    totalSteps: 3,
    stepName: 'Describe Image',
    stepRole: 'vision_analysis',
    instructionTemplate: 'Describe {{input}} concisely.',
    inputContext: 'Literal {{prev_output}} injection attempt on desk.',
    upstreamOutputs: [],
  });
  // Single-pass ensures {{prev_output}} inside user input is NOT recursively expanded
  assert.match(step1, /Literal \{\{prev_output\}\} injection attempt/);
  assert.match(step1, /Intermediate Output Contract/);

  const step2Omitted = compileStepInstruction({
    personaStyle: 'Deadpan visual comic.',
    stepOrder: 2,
    totalSteps: 3,
    stepName: 'Find Twist',
    stepRole: 'twist_planner',
    instructionTemplate: 'Identify the funniest non-cliche angle.',
    inputContext: 'Ignored raw input',
    upstreamOutputs: ['Step 1 visual observation text'],
  });
  assert.match(step2Omitted, /Upstream Step Output \(\{\{prev_output\}\}\):\nStep 1 visual observation text/);

  const step3Final = compileStepInstruction({
    personaStyle: 'Deadpan visual comic.',
    stepOrder: 3,
    totalSteps: 3,
    stepName: 'Synthesize 5 Captions',
    stepRole: 'caption_synthesis',
    instructionTemplate: 'Combine {{step_1_output}} with {{prev_output}}.',
    inputContext: 'Premise',
    upstreamOutputs: ['First visual summary', 'Second comic angle'],
  });
  assert.match(step3Final, /Combine First visual summary with Second comic angle\./);
  assert.match(step3Final, /Final Output Contract/);

  const tokens = tokenizeTemplateVariables('Use {{input}} then {{step_1_output}} and {{prev_output}}.');
  assert.equal(tokens.filter((t) => t.type === 'variable').length, 3);
});

test('parseFiveCaptions handles strict JSON, fenced JSON, and numbered lists while rejecting empty output', () => {
  const fromJson = parseFiveCaptions(
    '```json\n{"captions": ["One", "Two", "Three", "Four", "Five", "Six"]}\n```'
  );
  assert.equal(fromJson.length, 5);
  assert.equal(fromJson[0], 'One');

  const fromList = parseFiveCaptions(
    '1. First funny caption here\n2. Second funny caption here\n3. Third funny caption here'
  );
  assert.equal(fromList.length, 3);
  assert.equal(fromList[0], 'First funny caption here');

  assert.throws(() => parseFiveCaptions('   '), /invalid_output/);
});

test('SSRF and vision MIME validators block loopback/private/SVG inputs and allow valid PNG/HTTPS inputs', () => {
  assert.equal(isPublicIpAddress('127.0.0.1'), false);
  assert.equal(isPublicIpAddress('10.24.0.5'), false);
  assert.equal(isPublicIpAddress('169.254.169.254'), false);
  assert.equal(isPublicIpAddress('172.20.0.1'), false);
  assert.equal(isPublicIpAddress('192.168.1.9'), false);
  assert.equal(isPublicIpAddress('::1'), false);
  assert.equal(isPublicIpAddress('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIpAddress('::ffff:7f00:1'), false);
  assert.equal(isPublicIpAddress('::ffff:a9fe:a9fe'), false);
  assert.equal(isPublicIpAddress('::7f00:1'), false);
  assert.equal(isPublicIpAddress('64:ff9b::7f00:1'), false);
  assert.equal(isPublicIpAddress('2001:db8::1'), false);
  assert.equal(isPublicIpAddress('2002:7f00:1::1'), false);
  assert.equal(isPublicIpAddress('fe80::1'), false);
  assert.equal(isPublicIpAddress('93.184.216.34'), true);
  assert.equal(isPublicIpAddress('::ffff:93.184.216.34'), true);
  assert.equal(isPublicIpAddress('2606:4700:4700::1111'), true);

  assert.throws(() => validateExternalImageUrl('http://example.com/a.png'), /https:\/\//);
  assert.throws(() => validateExternalImageUrl('https://localhost/a.png'), /Private, loopback/);
  assert.throws(() => validateExternalImageUrl('https://127.0.0.1/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://169.254.169.254/latest'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[::ffff:127.0.0.1]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[::ffff:169.254.169.254]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[::127.0.0.1]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[64:ff9b::127.0.0.1]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[2001:db8::1]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://[2002:7f00:1::1]/a.png'), /Private or loopback/);
  assert.throws(() => validateExternalImageUrl('https://user:pass@example.com/a.png'), /credentials/);
  assert.throws(() => validateExternalImageUrl('https://example.com:8443/a.png'), /port 443/);
  assert.equal(
    validateExternalImageUrl('https://[2606:4700:4700::1111]/photo-1.png').hostname,
    '[2606:4700:4700::1111]'
  );
  assert.equal(
    validateExternalImageUrl('https://images.unsplash.com/photo-1.png').hostname,
    'images.unsplash.com'
  );

  // Reject raw SVG data URLs so Vision APIs never receive image/svg+xml
  assert.throws(
    () => parseBoundedImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    /Unsupported vision MIME/
  );

  const validPngB64 = Buffer.alloc(32, 7).toString('base64');
  const parsedPng = parseBoundedImageDataUrl(`data:image/png;base64,${validPngB64}`);
  assert.equal(parsedPng.mimeType, 'image/png');
  assert.equal(parsedPng.byteLength, 32);
});

test('Multimodal protocol builders and response extractors support all 4 LLM protocols and fail closed', () => {
  const providers = [
    {
      id: 'p-openai',
      slug: 'openai',
      name: 'OpenAI',
      api_base_url: 'https://api.openai.com/v1/responses',
      protocol: 'openai_responses',
      api_key_env: 'OPENAI_API_KEY',
      is_enabled: true,
    },
    {
      id: 'p-chat',
      slug: 'openai-chat',
      name: 'OpenAI Chat',
      api_base_url: 'https://api.openai.com/v1',
      protocol: 'openai_chat_completions',
      api_key_env: 'OPENAI_API_KEY',
      is_enabled: true,
    },
    {
      id: 'p-3p',
      slug: 'openrouter',
      name: 'OpenRouter',
      api_base_url: 'https://openrouter.ai/api/v1',
      protocol: 'openai_chat_completions',
      api_key_env: 'OPENAI_API_KEY',
      is_enabled: true,
    },
    {
      id: 'p-gemini',
      slug: 'gemini',
      name: 'Google Gemini',
      api_base_url: 'https://generativelanguage.googleapis.com/v1beta/models',
      protocol: 'gemini_generate_content',
      api_key_env: 'GEMINI_API_KEY',
      is_enabled: true,
    },
    {
      id: 'p-anthropic',
      slug: 'anthropic',
      name: 'Anthropic',
      api_base_url: 'https://api.anthropic.com/v1/messages',
      protocol: 'anthropic_messages',
      api_key_env: 'ANTHROPIC_API_KEY',
      is_enabled: true,
    },
    {
      id: 'p-disabled',
      slug: 'paused',
      name: 'Paused Provider',
      api_base_url: 'https://api.openai.com/v1/responses',
      protocol: 'openai_responses',
      api_key_env: 'OPENAI_API_KEY',
      is_enabled: false,
    },
  ];
  const models = [
    { id: 'm1', provider: 'openai', provider_id: 'p-openai', api_model: 'gpt-6-luna', name: 'GPT', is_enabled: true },
    { id: 'm2', provider: 'openai-chat', provider_id: 'p-chat', api_model: 'gpt-5.4-mini', name: 'GPT Chat', is_enabled: true },
    { id: 'm3', provider: 'openrouter', provider_id: 'p-3p', api_model: 'meta/llama-vision', name: 'Llama', is_enabled: true },
    { id: 'm4', provider: 'gemini', provider_id: 'p-gemini', api_model: 'gemini-3-flash-preview', name: 'Gemini', is_enabled: true },
    { id: 'm5', provider: 'anthropic', provider_id: 'p-anthropic', api_model: 'sonnet-vision-latest', name: 'Anthropic', is_enabled: true },
    { id: 'm6', provider: 'paused', provider_id: 'p-disabled', api_model: 'paused-model', name: 'Paused', is_enabled: true },
  ];
  const env = {
    OPENAI_API_KEY: 'test-key-openai',
    GEMINI_API_KEY: 'test-key-gemini',
    ANTHROPIC_API_KEY: 'test-key-anthropic',
  };

  const selectable = listSelectableChainModels({ providers, models, env });
  assert.equal(selectable.length, 5);
  assert.throws(
    () => resolveSelectedChainModel({ requestedKey: 'paused::paused-model', providers, models, env }),
    /disabled or not found/
  );

  const img = { mimeType: 'image/png', base64Data: 'AAAA' };

  // 1. openai_responses
  const reqResp = buildMultimodalStepHttpRequest({
    model: selectable[0],
    prompt: 'Describe image',
    apiKey: 'k1',
    image: img,
    expectFiveCaptionsJson: false,
  });
  assert.equal(reqResp.url, 'https://api.openai.com/v1/responses');
  assert.equal(Array.isArray(reqResp.body.input), true);

  // 2. openai_chat_completions (api.openai.com -> max_completion_tokens; 3P -> max_tokens)
  const reqChatOpenAi = buildMultimodalStepHttpRequest({
    model: selectable[1],
    prompt: 'Synthesize 5',
    apiKey: 'k1',
    image: img,
    expectFiveCaptionsJson: true,
  });
  assert.ok('max_completion_tokens' in reqChatOpenAi.body);
  assert.ok(!('max_tokens' in reqChatOpenAi.body));

  const reqChat3P = buildMultimodalStepHttpRequest({
    model: selectable[2],
    prompt: 'Synthesize 5',
    apiKey: 'k1',
    image: null,
    expectFiveCaptionsJson: true,
  });
  assert.ok('max_tokens' in reqChat3P.body);
  assert.ok(!('max_completion_tokens' in reqChat3P.body));

  // 3. gemini_generate_content
  const reqGemini = buildMultimodalStepHttpRequest({
    model: selectable[3],
    prompt: 'Describe image',
    apiKey: 'k2',
    image: img,
    expectFiveCaptionsJson: true,
  });
  assert.match(reqGemini.url, /gemini-3-flash-preview:generateContent$/);
  assert.equal(reqGemini.headers['x-goog-api-key'], 'k2');

  // 4. anthropic_messages
  const reqAnthropic = buildMultimodalStepHttpRequest({
    model: selectable[4],
    prompt: 'Describe image',
    apiKey: 'k3',
    image: img,
    expectFiveCaptionsJson: false,
  });
  assert.equal(reqAnthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(reqAnthropic.headers['x-api-key'], 'k3');

  // Extractors across all 4 protocols
  assert.equal(
    extractStepTextAndUsage(
      'openai_responses',
      { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'Step out 1' }] }], usage: { input_tokens: 10, output_tokens: 5 } },
      'gpt-6-luna'
    ).text,
    'Step out 1'
  );
  assert.equal(
    extractStepTextAndUsage(
      'openai_chat_completions',
      { choices: [{ finish_reason: 'stop', message: { content: 'Step out 2' } }], usage: { prompt_tokens: 12, completion_tokens: 6 } },
      'gpt-5.4-mini'
    ).text,
    'Step out 2'
  );
  assert.equal(
    extractStepTextAndUsage(
      'gemini_generate_content',
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'skip' }, { text: 'Step out 3' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 } },
      'gemini-3-flash-preview'
    ).text,
    'Step out 3'
  );
  assert.equal(
    extractStepTextAndUsage(
      'anthropic_messages',
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Step out 4' }], usage: { input_tokens: 14, output_tokens: 7 } },
      'sonnet-vision-latest'
    ).text,
    'Step out 4'
  );
});

test('Sample scenes and run normalizers match canonical Week 8 scene IDs and JSONB contract', () => {
  assert.deepEqual(
    SAMPLE_SCENES.map((s) => s.id),
    ['scene-stack-trace', 'scene-burning-ci', 'scene-cat-force-push', 'scene-ai-toaster']
  );
  assert.equal(getSampleSceneById('scene-burning-ci')?.title, '100% CI Pass in Burning Server Room');

  const steps = normalizeRunStepOutputs([
    {
      step_order: 1,
      step_id: 'abc',
      step_name: 'Describe',
      step_role: 'vision_analysis',
      output_field: 'image_description',
      compiled_prompt: 'Prompt 1',
      output_text: 'Visual details',
      latency_ms: 420,
      input_tokens: 100,
      output_tokens: 40,
    },
  ]);
  assert.equal(steps[0].output_text, 'Visual details');
  assert.deepEqual(normalizeFinalCaptions(['Cap 1', { caption: 'Cap 2' }]), ['Cap 1', 'Cap 2']);
});
