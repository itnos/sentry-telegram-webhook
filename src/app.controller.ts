import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import { Logger } from 'winston';
import { HookMessageDataType, SentryRequestType } from './app';
import { AppInterceptor } from './app.interceptor';
import { AppService } from './app.service';
import { AppHelper } from './app.helper';

@Controller()
@UseInterceptors(AppInterceptor)
export class AppController {
  constructor(
    @Inject('winston')
    private readonly logger: Logger,
    private readonly appService: AppService,
    private readonly appHelper: AppHelper,
  ) {}

  @Get()
  getHello() {
    return this.appService.getHello();
  }

  @Post('/sentry/webhooks')
  @HttpCode(HttpStatus.OK)
  webhooks(@Body() reqBody: SentryRequestType) {
    const running = async () => {
      try {
        this.logger.info(reqBody);

        const action = reqBody.action;
        const data = reqBody.data;

        let title: string;
        let culprit: string;
        let projectName: string;
        let projectSlug: string;
        let issueId: string;
        let webUrl: string;

        // Handle different event types
        if (data.issue) {
          // issue.created, issue.resolved, etc.
          title = data.issue.title;
          culprit = data.issue.culprit;
          projectName = data.issue.project?.name || 'Unknown';
          projectSlug = data.issue.project?.slug || '';
          issueId = data.issue.id;
          webUrl = data.issue.web_url || '';
        } else if (data.event) {
          // event_alert.triggered
          title = data.event.title;
          culprit = data.event.culprit;
          projectName = data.event.project?.name || 'Unknown';
          projectSlug = data.event.project?.slug || '';
          issueId = data.event.issue_id;
          webUrl = data.event.web_url || '';
        } else if (data.error) {
          // error.created
          title = data.error.title;
          culprit = data.error.culprit;
          projectName = 'Unknown';
          projectSlug = '';
          issueId = data.error.issue_id;
          webUrl = data.error.web_url || '';
        } else {
          this.logger.info('Unknown event structure, skipping');
          return;
        }

        if (projectSlug && !this.appHelper.isAllowNotification(projectSlug)) {
          this.logger.info(
            `This app slug "${projectSlug}" is not allowed for push notifications`,
          );
          return;
        }

        // Try to get issue details, but don't fail if it doesn't work
        let issueDetails = {};
        try {
          if (issueId) {
            issueDetails = await this.appService.getIssueDetail(issueId);
          }
        } catch (ex) {
          this.logger.warn('Failed to get issue details, continuing without them');
        }

        const hookMessageData: HookMessageDataType = {
          issueAction: action,
          appName: projectName,
          title: title,
          errorPosition: culprit,
          detailLink: webUrl || `${process.env.SENTRY_URL}/organizations/${process.env.SENTRY_ORGANIZATION_SLUG}/issues/${issueId}/`,
          ...issueDetails,
        };

        await this.appService.sentTelegramMessage(hookMessageData);
        this.logger.info('Telegram message sent successfully');
      } catch (ex) {
        this.logger.error(ex);
      }
    };

    running();
    return reqBody.installation || { message: 'success' };
  }
}
