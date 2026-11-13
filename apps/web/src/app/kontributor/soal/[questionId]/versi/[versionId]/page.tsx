'use client';
import { use } from 'react';
import { QuestionEditor } from '@/components/question-editor';

/** CTR-02 Create Question */
export default function Page({ params }: { params: Promise<{ questionId: string; versionId: string }> }) {
  const { questionId, versionId } = use(params);
  return <QuestionEditor key={versionId} questionId={questionId} versionId={versionId} basePath="/kontributor/soal" />;
}
