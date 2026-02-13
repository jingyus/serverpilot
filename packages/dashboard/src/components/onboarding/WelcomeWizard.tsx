// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  Server,
  MessageCircle,
  ChevronRight,
  ChevronLeft,
  X,
  CheckCircle2,
  Rocket,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'onboarding_completed';

export function isOnboardingCompleted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function markOnboardingCompleted(): void {
  localStorage.setItem(STORAGE_KEY, 'true');
}

interface Step {
  titleKey: string;
  descriptionKey: string;
  icon: typeof Settings;
  actionKey: string;
  route: string;
}

const STEPS: Step[] = [
  {
    titleKey: 'onboarding.step1Title',
    descriptionKey: 'onboarding.step1Desc',
    icon: Settings,
    actionKey: 'onboarding.step1Action',
    route: '/settings',
  },
  {
    titleKey: 'onboarding.step2Title',
    descriptionKey: 'onboarding.step2Desc',
    icon: Server,
    actionKey: 'onboarding.step2Action',
    route: '/servers',
  },
  {
    titleKey: 'onboarding.step3Title',
    descriptionKey: 'onboarding.step3Desc',
    icon: MessageCircle,
    actionKey: 'onboarding.step3Action',
    route: '/chat',
  },
];

export function WelcomeWizard({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);

  const handleSkip = useCallback(() => {
    markOnboardingCompleted();
    onComplete();
  }, [onComplete]);

  const handleNext = useCallback(() => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleFinish = useCallback(() => {
    markOnboardingCompleted();
    onComplete();
    navigate(STEPS[currentStep].route);
  }, [onComplete, navigate, currentStep]);

  const handleStepAction = useCallback(
    (route: string) => {
      markOnboardingCompleted();
      onComplete();
      navigate(route);
    },
    [onComplete, navigate],
  );

  const step = STEPS[currentStep];
  const StepIcon = step.icon;

  return (
    <Card
      className="mx-auto w-full max-w-lg"
      data-testid="welcome-wizard"
    >
      <CardHeader className="relative pb-4">
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4 h-8 w-8"
          onClick={handleSkip}
          data-testid="wizard-skip"
          aria-label={t('onboarding.skip')}
        >
          <X className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">{t('onboarding.title')}</CardTitle>
        </div>
        <CardDescription>{t('onboarding.subtitle')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress indicators */}
        <div className="flex items-center justify-center gap-2" data-testid="wizard-progress">
          {STEPS.map((_, i) => (
            <button
              key={i}
              className={cn(
                'h-2 rounded-full transition-all',
                i === currentStep
                  ? 'w-8 bg-primary'
                  : i < currentStep
                    ? 'w-2 bg-primary/60'
                    : 'w-2 bg-muted-foreground/30',
              )}
              onClick={() => setCurrentStep(i)}
              data-testid={`wizard-dot-${i}`}
              aria-label={t('onboarding.goToStep', { step: i + 1 })}
            />
          ))}
        </div>

        {/* Step content */}
        <div
          className="flex flex-col items-center rounded-lg border bg-muted/30 p-6 text-center"
          data-testid={`wizard-step-${currentStep}`}
        >
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <StepIcon className="h-6 w-6" />
          </div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t('onboarding.stepOf', { current: currentStep + 1, total: STEPS.length })}
          </p>
          <h3 className="mb-2 text-base font-semibold text-foreground">
            {t(step.titleKey)}
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {t(step.descriptionKey)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleStepAction(step.route)}
            data-testid={`wizard-action-${currentStep}`}
          >
            {t(step.actionKey)}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={handlePrev}
          disabled={currentStep === 0}
          data-testid="wizard-prev"
        >
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          {t('common.back')}
        </Button>

        {currentStep < STEPS.length - 1 ? (
          <Button
            size="sm"
            onClick={handleNext}
            data-testid="wizard-next"
          >
            {t('onboarding.next')}
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleFinish}
            data-testid="wizard-finish"
          >
            <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
            {t('onboarding.finish')}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
