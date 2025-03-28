import { context } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { Resource } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base'
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { PrismaInstrumentation } from '@prisma/instrumentation'

import { NewPrismaClient } from '../_utils/types'
import testMatrix from './_matrix'
// @ts-ignore
import type { PrismaClient } from './node_modules/@prisma/client'

let prisma: PrismaClient<{ log: [{ emit: 'event'; level: 'query' }] }>
declare let newPrismaClient: NewPrismaClient<typeof PrismaClient>

let inMemorySpanExporter: InMemorySpanExporter

beforeAll(() => {
  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)

  inMemorySpanExporter = new InMemorySpanExporter()

  const basicTracerProvider = new BasicTracerProvider({
    sampler: new TraceIdRatioBasedSampler(0), // 0% sampling!!
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: 'test-name',
      [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
    }),
  })

  basicTracerProvider.addSpanProcessor(new SimpleSpanProcessor(inMemorySpanExporter))
  basicTracerProvider.register()

  registerInstrumentations({
    instrumentations: [new PrismaInstrumentation({ middleware: true })],
  })
})

afterAll(() => {
  context.disable()
})

testMatrix.setupTestSuite(
  () => {
    const queries: string[] = []

    function checkQueriesHaveNotTraceparent() {
      const result = !queries.some((q) => q.includes('traceparent'))

      queries.length = 0

      return result
    }

    beforeAll(() => {
      prisma = newPrismaClient({ log: [{ emit: 'event', level: 'query' }] })

      prisma.$on('query', (e) => queries.push(e.query))
    })

    // https://github.com/prisma/prisma/issues/19088
    test('should perform a query and assert that no spans were generated', async () => {
      await prisma.user.findMany()

      const spans = inMemorySpanExporter.getFinishedSpans()

      expect(spans).toHaveLength(0)
      expect(checkQueriesHaveNotTraceparent()).toBe(true)
    })

    // https://github.com/prisma/prisma/issues/19088
    test('should perform a query and assert that no spans were generated via itx', async () => {
      await prisma.$transaction(async (prisma) => {
        await prisma.user.findMany()
      })

      const spans = inMemorySpanExporter.getFinishedSpans()

      expect(spans).toHaveLength(0)
      expect(checkQueriesHaveNotTraceparent()).toBe(true)
    })
  },
  {
    skipDefaultClientInstance: true,
    skipDriverAdapter: {
      from: ['js_d1'],
      reason: 'D1 does not support interactive transactions',
    },
  },
)
