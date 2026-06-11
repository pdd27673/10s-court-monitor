import { SPORTS_LIST } from '@/lib/gametime/types';
import type { Sport } from '@/lib/gametime/types';
import { SportPageClient } from './SportPageClient';

export function generateStaticParams() {
  return SPORTS_LIST.map(s => ({ sport: s.id }));
}

interface Props {
  params: Promise<{ sport: string }>;
}

export default async function SportPage({ params }: Props) {
  const { sport } = await params;
  return <SportPageClient sport={sport as Sport} />;
}
