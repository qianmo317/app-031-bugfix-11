import { reactive } from 'vue'

export type PrintSection = 'nest' | 'cut' | 'order' | 'labels'

interface PrintState {
  jobId: string | null
  sections: PrintSection[]
}

export const printState = reactive<PrintState>({
  jobId: null,
  sections: ['nest', 'cut', 'order', 'labels']
})

export function printJob(jobId: string, sections: PrintSection[]): void {
  printState.jobId = jobId
  printState.sections = sections
  // 等打印文档渲染完再唤起打印
  setTimeout(() => window.print(), 60)
}
