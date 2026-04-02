# AI Flow v4 - Streaming-First AI Orchestration

A TypeScript framework for building **streaming-first**, **type-safe** AI workflows with real-time reasoning, structured outputs, and tool execution.

## Core Philosophy

**Everything streams.** Get immediate feedback from AI reasoning while maintaining the reliability of structured outputs and validated tool execution.

## Two Stage Types

### OutputStage - Structured Results + Tools

For when you need **validated JSON outputs** and **tool execution**:

```typescript
const analysisStage = createOutputStage<
  'analysis',
  AppContext,
  StageStorage,
  AnalysisResult,
  { analyzeText: typeof analyzeTextTool }
>('analysis', {
  model: 'gpt-4',
  tools: { analyzeText },
  output: structuredOutput,
  instructions: prompt,
  maxSteps: 5,
});
```

**Step Flow**: `reasoning` → `tool` → `output`

### TextStage - Pure Streaming Text

For when you need **natural conversation** and **streaming responses**:

```typescript
const chatStage = createTextStage<'chat', AppContext>('chat', {
  model: 'gpt-4',
  instructions: prompt,
  inputs: { userMessage },
  context: { previousResults },
});
```

**Step Flow**: `reasoning` → `chunk` → `text`

## Basic Usage

### 1. Define Your Context

```typescript
type AppContext = {
  userMessage: string;
  userPreferences: UserPrefs;
  analysisResults?: AnalysisData;
};
```

### 2. Create Tools (for OutputStages)

```typescript
const analyzeText = createAiTool<
  AppContext,
  { text: string; includeMetrics: boolean },
  { sentiment: string; score: number },
  { api: AnalysisAPI }
>('analyze-text', {
  description: 'Analyze text sentiment and metrics',
  parameterSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      includeMetrics: { type: 'boolean' }
    },
    required: ['text']
  },
  parseParameters: validateParams,
  execute: async (params, context, deps) => {
    const result = await deps.api.analyze(params.text);
    return { success: true, data: result };
  },
  render: (data) => `Analysis: ${data.sentiment} (${data.score})`
});
```

### 3. Create Stages

```typescript
// Structured analysis with tools
const analysisStage = createOutputStage<
  'analysis',
  AppContext,
  { count: number },
  AnalysisResult,
  { analyzeText: typeof analyzeText }
>('analysis', {
  model: 'gpt-4',
  tools: { analyzeText },
  output: createAiOutput<AppContext, AnalysisResult>('analysis', {
    schema: AnalysisResultSchema,
    validate: validateAnalysisResult,
    render: (ctx, result) => `Analysis: ${result?.summary}`
  }),
  instructions: createAiPrompt<AppContext>('analyze', {
    render: (ctx) => `Analyze: "${ctx.userMessage}"`
  }),
  inputs: { userMessage },
  storage: () => ({ count: 0 }),
  maxSteps: 3
});

// Streaming response
const responseStage = createTextStage<'response', AppContext>('response', {
  model: 'gpt-4',
  instructions: createAiPrompt<AppContext>('respond', {
    render: () => 'Provide a helpful response based on the analysis'
  }),
  inputs: { userMessage },
  context: { 
    analysis: analysisStage.output.asContext() 
  }
});
```

### 4. Build Your Flow

```typescript
const flow = createAiFlow<
  AppContext,
  { analysis: typeof analysisStage; response: typeof responseStage }
>('ai-assistant', {
  stages: { analysis: analysisStage, response: responseStage }
});

const run = flow
  .onStep('analysis', async ({ step, flow }) => {
    if (step.kind === 'reasoning') {
      // Real-time AI reasoning
      console.log('AI thinking:', step.reasoning.delta);
      return step.next();
    }
    
    if (step.kind === 'tool') {
      // Tool execution results
      const results = step.toolData.analyzeText || [];
      
      // Update stage storage
      flow.setStorage(s => ({ count: s.count + results.length }));
      
      return step.next();
    }
    
    if (step.kind === 'output') {
      // Structured, validated output
      console.log('Analysis complete:', step.response);
      
      return step.output.accept((result, ctx) => ({
        to: 'response',
        ctx: { ...ctx, analysisResults: result }
      }));
    }
  })
  .onStep('response', async ({ step }) => {
    if (step.kind === 'reasoning') {
      // AI reasoning while generating response
      updateUI(`AI: ${step.reasoning.delta}`);
      return step.next();
    }
    
    if (step.kind === 'chunk') {
      // Streaming text chunks
      updateUI(`Response: ${step.response.delta}`);
      return step.next();
    }
    
    if (step.kind === 'text') {
      // Final complete text
      console.log('Final response:', step.response.text);
      
      return step.output.accept((text, ctx) => ({ ctx }));
    }
  })
  .start({
    flow: {
      userMessage: 'Analyze this message for sentiment',
      userPreferences: defaultPrefs
    },
    firstStage: 'analysis',
    deps: { openAI, logger, api }
  });

const result = await run.complete();
```

## Step Types Reference

### OutputStage Steps

#### Reasoning Steps

```typescript
if (step.kind === 'reasoning') {
  // Real-time reasoning stream
  const delta = step.reasoning.delta; // Current reasoning chunk
  const summaries = step.reasoning.summaries; // Completed reasoning parts
  return step.next();
}
```

#### Tool Steps

```typescript
if (step.kind === 'tool') {
  // Tool execution results
  const toolResults = step.toolData.toolName || [];
  const toolErrors = step.toolFailures.toolName || [];
  
  // Update stage state
  flow.setStorage(s => ({ ...s, toolsExecuted: s.toolsExecuted + 1 }));
  
  return step.next();
}
```

#### Output Steps

```typescript
if (step.kind === 'output') {
  // Validated structured output
  const result = step.response; // Typed according to your output schema
  
  // Evaluate output quality (optional)
  const evaluation = await step.output.evaluate(qualityEvaluator);
  
  if (evaluation?.score > 0.8) {
    return step.output.accept((output, ctx) => ({
      to: 'nextStage',
      ctx: { ...ctx, result: output }
    }));
  } else {
    return step.output.reject({
      text: 'Quality too low, please improve'
    });
  }
}
```

### TextStage Steps

#### Reasoning Steps (TextStage)

```typescript
if (step.kind === 'reasoning') {
  // Same as OutputStage - real-time reasoning
  updateReasoningUI(step.reasoning.delta);
  return step.next();
}
```

#### Chunk Steps

```typescript
if (step.kind === 'chunk') {
  // Streaming text generation
  const delta = step.response.delta; // New text chunk
  const fullText = step.response.text; // Text so far
  
  updateStreamingUI(delta);
  return step.next();
}
```

#### Text Steps

```typescript
if (step.kind === 'text') {
  // Final complete text
  const finalText = step.response.text;
  
  return step.output.accept((text, ctx) => ({
    to: 'nextStage', // Optional
    ctx: { ...ctx, responseText: text }
  }));
}
```

## Advanced Features

### Dynamic Tool Choice

Control when tools are required vs optional:

```typescript
const stage = createOutputStage('stage', {
  // ... other config
  toolChoice: ({ turn, storage, toolCallsMade }) => {
    // Require tools for first few calls, then make optional
    return toolCallsMade < 3 ? 'required' : 'auto';
  }
});
```

### Output Evaluation

Evaluate outputs before accepting:

```typescript
const qualityEvaluator = createEvaluationStage<AppContext, QualityScore>(
  'quality-check', {
    model: 'gpt-4',
    instructions: (ctx) => 'Evaluate the quality of this analysis',
    inputs: (ctx, candidate) => [
      { role: 'user', type: 'message', content: `Evaluate: ${JSON.stringify(candidate)}` }
    ],
    schema: QualityScoreSchema,
    validate: validateQualityScore
  }
);

// In your step handler:
if (step.kind === 'output') {
  const quality = await step.output.evaluate(qualityEvaluator);
  
  if (quality?.score > 0.8) {
    return step.output.accept((output, ctx) => ({ ctx }));
  } else {
    return step.output.reject({ text: 'Please improve the analysis' });
  }
}
```

### Context Management

Update flow context and stage storage:

```typescript
.onStep('analysis', async ({ step, flow }) => {
  // Update flow context (shared across stages)
  flow.setContext(ctx => ({
    ...ctx,
    analysisStarted: true
  }));
  
  // Update stage storage (stage-specific)
  flow.setStorage(storage => ({
    ...storage,
    attempts: storage.attempts + 1
  }));
})
```

### Resumability

Flows are fully resumable from any point:

```typescript
// Save state
const snapshot = run.snapshot();

// Resume later (even after restart)
const resumedRun = flow.resume(snapshot, deps);
const result = await resumedRun.complete();
```

## Key Benefits

✅ **Streaming by Default** - Immediate reasoning feedback, no configuration needed  
✅ **Type Safety** - Full TypeScript support with compile-time guarantees  
✅ **Tool Validation** - Automatic parameter validation with descriptive errors  
✅ **Output Validation** - JSON schema validation with retry logic  
✅ **Resumable** - Pause and resume flows at any point  
✅ **Composable** - Mix structured and streaming stages seamlessly  
✅ **Production Ready** - Error handling, retries, and monitoring built-in  

## Architecture

The framework follows a **streaming-first** philosophy:

- **Real-time reasoning**: See AI thinking as it happens
- **Incremental outputs**: Get results as soon as they're available  
- **Structured validation**: Ensure data quality without sacrificing speed
- **Tool orchestration**: Execute complex workflows with confidence
- **State management**: Reliable state tracking for long-running processes

Perfect for building AI applications that feel **responsive** and **reliable**. 🚀
