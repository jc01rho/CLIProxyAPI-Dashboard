import { aggregateCredentialDailyRows } from '../lib/credentialAggregation'

self.onmessage = (event) => {
    const result = aggregateCredentialDailyRows(event.data?.dailyRows || [])
    self.postMessage(result)
}
