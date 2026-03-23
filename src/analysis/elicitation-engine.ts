/**
 * ServalSheets - Elicitation Engine
 *
 * Generates targeted questions to fill confidence gaps identified by the
 * ConfidenceScorer. Questions are:
 *
 * 1. PROGRESSIVE - Start broad, get specific as understanding grows
 * 2. CONTEXTUAL - Based on what we've already observed in the data
 * 3. PRIORITIZED - Most impactful questions first
 * 4. ADAPTIVE - Questions change based on previous answers
 *
 * The elicitation flow:
 *   ConfidenceScorer.assess() → ElicitationEngine.generate()
 *   → User answers → ConfidenceScorer.update() → re-assess
 *
 * This follows the Profile → Hypothesize → Score → Question → Consolidate
 * pattern for progressive data understanding.
 *
 * MCP Protocol: 2025-11-25
 */

import { logger } from '../utils/logger.js';
import type {
  ConfidenceAssessment,
  ConfidenceDimension,
  UserProvidedContext,
} from './confidence-scorer.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Question types for different elicitation strategies
 */
export type QuestionType =
  | 'multiple_choice' // Pick from detected options
  | 'yes_no' // Binary confirmation
  | 'free_text' // Open-ended
  | 'ranking' // Order detected items
  | 'confirmation'; // Confirm a hypothesis

/**
 * Priority level for elicitation
 */
export type QuestionPriority = 'critical' | 'important' | 'helpful' | 'optional';

/**
 * A generated elicitation question
 */
export interface ElicitationQuestion {
  id: string;
  /** The question text */
  question: string;
  /** Why we're asking this */
  reason: string;
  /** Which confidence dimension this improves */
  targetDimension: ConfidenceDimension;
  /** Expected confidence boost if answered (0-30 points) */
  expectedBoost: number;
  /** Question format */
  type: QuestionType;
  /** Suggested answers for multiple_choice */
  options?: string[];
  /** Default/suggested answer based on inference */
  suggestedAnswer?: string;
  /** Priority of this question */
  priority: QuestionPriority;
  /** Context shown with the question */
  context?: string;
  /** Tags for answer processing */
  answerMapsTo: keyof UserProvidedContext;
}

/**
 * Elicitation result - a set of questions to ask
 */
export interface ElicitationResult {
  /** Whether elicitation is recommended */
  shouldElicit: boolean;
  /** Why or why not */
  reason: string;
  /** Questions to ask, ordered by priority */
  questions: ElicitationQuestion[];
  /** Current confidence summary */
  confidenceSummary: {
    overall: number;
    structure: number;
    content: number;
    relationships: number;
    purpose: number;
  };
  /** How many questions to ask (recommended batch size) */
  recommendedBatchSize: number;
  /** Estimated confidence after answering all questions */
  projectedConfidenceAfterElicitation: number;
}

/**
 * User's answer to an elicitation question
 */
export interface ElicitationAnswer {
  questionId: string;
  answer: string;
  /** Additional context the user provided */
  additionalContext?: string;
}

// ============================================================================
// QUESTION TEMPLATES
// ============================================================================

interface QuestionTemplate {
  id: string;
  dimension: ConfidenceDimension;
  trigger: (assessment: ConfidenceAssessment) => boolean;
  generate: (assessment: ConfidenceAssessment) => Omit<ElicitationQuestion, 'id'>;
  priority: QuestionPriority;
  boost: number;
}

// ============================================================================
// ENGINE
// ============================================================================

/**
 * Generates targeted elicitation questions based on confidence gaps
 */
export class ElicitationEngine {
  private templates: QuestionTemplate[];
  private questionCounter = 0;

  constructor() {
    this.templates = this.buildTemplates();
  }

  /**
   * Generate elicitation questions from a confidence assessment
   */
  generate(assessment: ConfidenceAssessment): ElicitationResult {
    logger.info('ElicitationEngine: Generating questions', {
      spreadsheetId: assessment.spreadsheetId,
      overallScore: assessment.overallScore,
      shouldElicit: assessment.shouldElicit,
    });

    if (!assessment.shouldElicit && assessment.overallScore >= 75) {
      return {
        shouldElicit: false,
        reason: `Confidence is sufficient (${assessment.overallScore}/100). Proceeding with analysis.`,
        questions: [],
        confidenceSummary: this.extractSummary(assessment),
        recommendedBatchSize: 0,
        projectedConfidenceAfterElicitation: assessment.overallScore,
      };
    }

    // Generate questions from templates
    const questions: ElicitationQuestion[] = [];
    for (const template of this.templates) {
      if (template.trigger(assessment)) {
        const q = template.generate(assessment);
        questions.push({
          ...q,
          id: `elicit_${++this.questionCounter}_${template.id}`,
        });
      }
    }

    // Also add questions from the confidence gaps themselves
    for (const gap of assessment.topGaps) {
      // Avoid duplicates with template-generated questions
      if (
        !questions.some(
          (q) =>
            q.targetDimension === gap.dimension &&
            q.question.toLowerCase().includes(gap.gap.toLowerCase().split(' ')[0] ?? '')
        )
      ) {
        questions.push({
          id: `elicit_${++this.questionCounter}_gap`,
          question: gap.question,
          reason: gap.gap,
          targetDimension: gap.dimension,
          expectedBoost: gap.impactOnConfidence,
          type: 'free_text',
          priority: gap.impactOnConfidence > 15 ? 'important' : 'helpful',
          answerMapsTo: this.dimensionToContextKey(gap.dimension),
        });
      }
    }

    // Sort by priority then by expected boost
    const priorityOrder: Record<QuestionPriority, number> = {
      critical: 0,
      important: 1,
      helpful: 2,
      optional: 3,
    };
    questions.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return b.expectedBoost - a.expectedBoost;
    });

    // Limit to top questions
    const limitedQuestions = questions.slice(0, 7);

    // Calculate projected confidence
    const totalBoost = limitedQuestions.reduce((sum, q) => sum + q.expectedBoost, 0);
    const projected = Math.min(100, assessment.overallScore + Math.round(totalBoost * 0.7)); // 70% effectiveness assumed

    // Recommend batch size: 2-3 questions at a time for better UX
    const batchSize = Math.min(3, limitedQuestions.filter((q) => q.priority !== 'optional').length);

    const result: ElicitationResult = {
      shouldElicit: limitedQuestions.length > 0,
      reason:
        limitedQuestions.length > 0
          ? `Confidence at ${assessment.overallScore}/100. ${limitedQuestions.length} questions could improve understanding.`
          : 'No significant gaps to fill.',
      questions: limitedQuestions,
      confidenceSummary: this.extractSummary(assessment),
      recommendedBatchSize: batchSize,
      projectedConfidenceAfterElicitation: projected,
    };

    logger.info('ElicitationEngine: Questions generated', {
      questionCount: limitedQuestions.length,
      batchSize,
      projectedConfidence: projected,
    });

    return result;
  }

  /**
   * Process user answers into UserProvidedContext
   */
  processAnswers(
    questions: ElicitationQuestion[],
    answers: ElicitationAnswer[]
  ): UserProvidedContext {
    const context: UserProvidedContext = {};

    for (const answer of answers) {
      const question = questions.find((q) => q.id === answer.questionId);
      if (!question) continue;

      const key = question.answerMapsTo;
      const value = answer.answer;

      switch (key) {
        case 'businessDomain':
          context.businessDomain = value;
          break;
        case 'intent':
          context.intent = value;
          break;
        case 'headerDescriptions': {
          // Parse "Column A: description, Column B: description" format
          if (!context.headerDescriptions) context.headerDescriptions = {};
          const pairs = value.split(/[,;]\s*/);
          for (const pair of pairs) {
            const [col, desc] = pair.split(/:\s*/);
            if (col && desc) {
              context.headerDescriptions[col.trim()] = desc.trim();
            }
          }
          break;
        }
        case 'sheetRelationships':
          context.sheetRelationships = value;
          break;
        case 'dataQualityExpectations':
          context.dataQualityExpectations = value;
          break;
        case 'keyColumns':
          context.keyColumns = value.split(/[,;]\s*/).map((s) => s.trim());
          break;
        case 'freeformContext':
          context.freeformContext = (context.freeformContext || '') + ' ' + value;
          break;
      }

      // Also capture additional context
      if (answer.additionalContext) {
        context.freeformContext = (context.freeformContext || '') + ' ' + answer.additionalContext;
      }
    }

    return context;
  }

  // ==========================================================================
  // TEMPLATE BUILDERS
  // ==========================================================================

  private buildTemplates(): QuestionTemplate[] {
    return [
      // PURPOSE: Business domain
      {
        id: 'domain_detection',
        dimension: 'purpose',
        trigger: (a) => this.getDimScore(a, 'purpose') < 50,
        generate: (_a) => ({
          question: 'What is this spreadsheet used for?',
          reason:
            'Understanding the business context helps me provide better analysis and suggestions.',
          targetDimension: 'purpose',
          expectedBoost: 20,
          type: 'multiple_choice' as QuestionType,
          options: [
            'Financial tracking / budgeting',
            'Customer / CRM data',
            'Project management',
            'Inventory / product management',
            'HR / employee data',
            'Analytics / reporting',
            'Other',
          ],
          priority: 'critical' as QuestionPriority,
          answerMapsTo: 'businessDomain' as keyof UserProvidedContext,
        }),
        priority: 'critical',
        boost: 20,
      },

      // PURPOSE: User intent
      {
        id: 'user_intent',
        dimension: 'purpose',
        trigger: (a) => this.getDimScore(a, 'purpose') < 65,
        generate: () => ({
          question: 'What would you like to accomplish with this spreadsheet?',
          reason: 'Knowing your goal helps me prioritize the most relevant insights.',
          targetDimension: 'purpose',
          expectedBoost: 15,
          type: 'multiple_choice' as QuestionType,
          options: [
            'Understand the data',
            'Clean up data quality issues',
            'Create visualizations / charts',
            'Optimize performance',
            'Set up for a specific workflow',
            'Something else',
          ],
          priority: 'important' as QuestionPriority,
          answerMapsTo: 'intent' as keyof UserProvidedContext,
        }),
        priority: 'important',
        boost: 15,
      },

      // STRUCTURE: Column descriptions for low-header sheets
      {
        id: 'column_descriptions',
        dimension: 'structure',
        trigger: (a) => {
          if (!a.columns) return false;
          const lowConfCols = a.columns.filter((c) => c.purposeConfidence < 40);
          return lowConfCols.length > 2;
        },
        generate: (a) => {
          const lowCols = (a.columns || []).filter((c) => c.purposeConfidence < 40).slice(0, 5);
          const colList = lowCols.map((c) => c.header || `Column ${c.columnIndex + 1}`).join(', ');
          return {
            question: `Can you describe what these columns contain: ${colList}?`,
            reason: 'Several columns lack clear headers or have ambiguous names.',
            targetDimension: 'structure',
            expectedBoost: 15,
            type: 'free_text' as QuestionType,
            context: `Format: "ColumnName: description, ColumnName: description"`,
            priority: 'important' as QuestionPriority,
            answerMapsTo: 'headerDescriptions' as keyof UserProvidedContext,
          };
        },
        priority: 'important',
        boost: 15,
      },

      // STRUCTURE: Multi-sheet relationships
      {
        id: 'sheet_relationships',
        dimension: 'structure',
        trigger: (a) => {
          const structDim = a.dimensions.find((d) => d.dimension === 'structure');
          return (
            (structDim?.gaps.some((g) => g.toLowerCase().includes('multi-sheet')) ?? false) &&
            this.getDimScore(a, 'structure') < 65
          );
        },
        generate: () => ({
          question: 'How are the different sheets related to each other?',
          reason: 'Understanding sheet relationships helps analyze cross-references.',
          targetDimension: 'structure',
          expectedBoost: 12,
          type: 'free_text' as QuestionType,
          priority: 'helpful' as QuestionPriority,
          answerMapsTo: 'sheetRelationships' as keyof UserProvidedContext,
        }),
        priority: 'helpful',
        boost: 12,
      },

      // CONTENT: Mixed type columns
      {
        id: 'mixed_types',
        dimension: 'content',
        trigger: (a) => {
          if (!a.columns) return false;
          return a.columns.some((c) => c.typeConfidence < 30);
        },
        generate: (a) => {
          const mixedCols = (a.columns || []).filter((c) => c.typeConfidence < 30).slice(0, 3);
          const names = mixedCols.map((c) => c.header || `Column ${c.columnIndex + 1}`).join(', ');
          return {
            question: `${names} ${mixedCols.length > 1 ? 'have' : 'has'} mixed data types. What should ${mixedCols.length > 1 ? 'they' : 'it'} contain?`,
            reason: 'Knowing the expected type helps identify data entry errors.',
            targetDimension: 'content',
            expectedBoost: 10,
            type: 'free_text' as QuestionType,
            priority: 'helpful' as QuestionPriority,
            answerMapsTo: 'dataQualityExpectations' as keyof UserProvidedContext,
          };
        },
        priority: 'helpful',
        boost: 10,
      },

      // CONTENT: Quality expectations
      {
        id: 'quality_expectations',
        dimension: 'content',
        trigger: (a) => {
          const contentDim = a.dimensions.find((d) => d.dimension === 'content');
          return (
            (contentDim?.gaps.some((g) => g.toLowerCase().includes('quality')) ?? false) &&
            this.getDimScore(a, 'content') < 50
          );
        },
        generate: () => ({
          question: 'Are there known quality issues in this data, or is it expected to be clean?',
          reason: 'Understanding expectations helps calibrate quality scoring.',
          targetDimension: 'content',
          expectedBoost: 10,
          type: 'multiple_choice' as QuestionType,
          options: [
            'Data should be clean - flag all issues',
            'Some messiness is expected - focus on major issues',
            'Raw/imported data - needs significant cleaning',
            'Not sure',
          ],
          priority: 'helpful' as QuestionPriority,
          answerMapsTo: 'dataQualityExpectations' as keyof UserProvidedContext,
        }),
        priority: 'helpful',
        boost: 10,
      },

      // RELATIONSHIPS: Key columns
      {
        id: 'key_columns',
        dimension: 'relationships',
        trigger: (a) => this.getDimScore(a, 'relationships') < 45,
        generate: () => ({
          question:
            'Are there any columns that serve as unique identifiers or keys (e.g., ID, email, SKU)?',
          reason: 'Identifying key columns helps map relationships and detect duplicates.',
          targetDimension: 'relationships',
          expectedBoost: 12,
          type: 'free_text' as QuestionType,
          priority: 'helpful' as QuestionPriority,
          answerMapsTo: 'keyColumns' as keyof UserProvidedContext,
        }),
        priority: 'helpful',
        boost: 12,
      },
    ];
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private getDimScore(assessment: ConfidenceAssessment, dim: ConfidenceDimension): number {
    return assessment.dimensions.find((d) => d.dimension === dim)?.score ?? 0;
  }

  private extractSummary(assessment: ConfidenceAssessment): {
    overall: number;
    structure: number;
    content: number;
    relationships: number;
    purpose: number;
  } {
    const dimMap: Record<string, number> = {};
    for (const dim of assessment.dimensions) {
      dimMap[dim.dimension] = dim.score;
    }
    return {
      overall: assessment.overallScore,
      structure: dimMap['structure'] ?? 0,
      content: dimMap['content'] ?? 0,
      relationships: dimMap['relationships'] ?? 0,
      purpose: dimMap['purpose'] ?? 0,
    };
  }

  private dimensionToContextKey(dim: ConfidenceDimension): keyof UserProvidedContext {
    switch (dim) {
      case 'purpose':
        return 'businessDomain';
      case 'structure':
        return 'headerDescriptions';
      case 'content':
        return 'dataQualityExpectations';
      case 'relationships':
        return 'keyColumns';
      default:
        return 'freeformContext';
    }
  }
}
