export interface RecallSessionVO {
  id: number;
  userId: number;
  noteId: number | null;
  cardId: number | null;
  title: string;
  sourceText: string | null;
  round1Text: string | null;
  round1Score: number | null;
  round2Text: string | null;
  round2Score: number | null;
  round3Text: string | null;
  round3Score: number | null;
  currentRound: number;
  status: string;
  round3DueTime: string | null;
  completedTime: string | null;
  createTime: string;
  updateTime: string;
  scoreTrend: (number | null)[];
  improvementPct: (number | null)[];
}

export interface CreateRecallDTO {
  sourceText: string;
  noteId?: number | null;
  cardId?: number | null;
  title?: string;
}

export interface SubmitRecallDTO {
  round: number;
  text: string;
}
