# AWS API deployment

This repository is prepared to run its Express API in an Amazon ECS Express Mode service backed by AWS Fargate. The existing GitHub Pages frontend can keep calling `POST /api/analyze`; its API base URL remains configurable through the `DESIGNLENS_API_BASE` GitHub repository variable.

ECS Express Mode creates the Fargate service, HTTPS load balancer, health checks, logging, and CPU-based scaling. The initial task size in the deployment workflow is 2 vCPU and 8 GiB RAM, with one to three tasks. This gives the analyzer more CPU than a small shared web-service plan; CloudWatch CPU and memory metrics can guide later adjustments. [AWS has closed App Runner to new customers](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html), so ECS Express Mode is the deployable managed option here.

## Cost estimate

At current Mumbai Linux/x86 Fargate list rates, one 2-vCPU/8-GiB task running continuously is about **US$89/month** for compute. Include the Application Load Balancer, public IPv4 addresses, and a small amount of load balancer capacity, and budget roughly **US$120/month with one task** or **US$310/month if all three tasks run continuously**. These estimates exclude taxes and vary with scan traffic, data transfer, and CloudWatch logs. Fargate is billed by requested task CPU, memory, and runtime; ECS Express Mode itself has no extra fee, while the underlying Fargate, load balancer, logs, and data transfer are billed separately ([Fargate pricing](https://aws.amazon.com/fargate/pricing/), [ECS Express Mode pricing](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html), [load balancer pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)). Autoscaling from one to three tasks is not a hard monthly spending cap.

## Before enabling deployment

The AWS Builder ID profile is a sign-in identity; it is not itself an AWS account or CLI/API credential. An AWS account/project with permission to create ECS, Fargate, ECR, load balancing, IAM, and CloudWatch resources is required. Do not put Builder ID profile details or AWS credentials in this repository.

First check [AWS Settings → Projects](https://docs.aws.amazon.com/accounts/latest/reference/use-aws-settings.html) for an existing project tied to your Builder ID. If you have access to the new AWS experience, create a `DesignLens` project there; ECS and ECR are supported. If you do not have AWS Settings/projects, create an AWS account through [AWS sign-up](https://portal.aws.amazon.com/billing/signup). Account sign-up requires the account owner to provide billing/contact details and complete any verification and agreement steps. Keep those details private. AWS resources for the running service are billed separately from the Builder ID profile; ECS Express Mode itself has no extra fee, while Fargate, the load balancer, logs, and data transfer can incur charges.

The included [CloudFormation template](../infra/aws-foundation.yml) creates the `designlens-api` ECR repository, ECS task execution and Express infrastructure roles, GitHub OIDC provider, and a GitHub Actions deployment role. Deploy it in Mumbai (`ap-south-1`) with named IAM role capability:

```bash
aws cloudformation deploy \
  --stack-name designlens-aws-foundation \
  --template-file infra/aws-foundation.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ap-south-1
```

The deployment role is trusted only for this repository's `production` environment on `main`. ECR push rights are scoped to `designlens-api`; `iam:PassRole` is restricted to the two ECS roles; and load balancer timeout changes are restricted to Application Load Balancers tagged `Project=DesignLens`. The policy includes the ECS Express service-management permissions from the [AWS action's IAM guidance](https://github.com/aws-actions/amazon-ecs-deploy-express-service#iam-permissions). No long-lived AWS access keys are created.

The AWS identity used to create these prerequisites must have permission to pass the infrastructure and task execution roles. Keep the GitHub OIDC trust limited to `repo:Ayushjaiswal001/designlens:environment:production`; do not create long-lived AWS access keys for Actions.

## GitHub configuration

Create a GitHub environment named `production`, then add the deployment role ARN from CloudFormation outputs as its secret:

**Environment secret**

- `AWS_ROLE_ARN`: ARN of the GitHub Actions deployment role.

**Environment variables**

- `AWS_REGION`: for example `ap-south-1`.
- `ECR_REPOSITORY`: `designlens-api`.
- `ECS_SERVICE`: `designlens-api`.
- `ECS_EXECUTION_ROLE_ARN`: ARN of the task execution role.
- `ECS_INFRASTRUCTURE_ROLE_ARN`: ARN of the ECS Express infrastructure role.
- `DESIGNLENS_ALLOWED_ORIGINS`: `https://ayushjaiswal001.github.io`.

Create the repository variable `AWS_DEPLOYMENT_ENABLED` and set it to `true` only when the AWS stack and environment settings are ready. Until then, pushes to `main` skip the AWS deployment job.

After a successful deployment, the AWS workflow raises the load balancer idle timeout and writes its HTTPS endpoint to the GitHub repository variable `DESIGNLENS_API_BASE`. It then dispatches the GitHub Pages workflow to publish the frontend configuration. The endpoint is also available as the Express action's `endpoint` output in the Actions run.

## Long scan requests

The analyzer can spend up to 120 seconds on one scan. Application Load Balancers default to a 60-second idle timeout, so the deployment workflow sets the generated load balancer's `idle_timeout.timeout_seconds` to `180` before publishing the frontend endpoint. Also keep the HTTP client timeout longer than the analyzer timeout.

## AWS references

- [Amazon ECS Express Mode overview and availability](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-overview.html)
- [ECS Express Mode resources and defaults](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/express-service-work.html)
- [AWS Builder ID and AWS account credentials](https://docs.aws.amazon.com/signin/latest/userguide/differences-builder-id.html)
- [Configure an Application Load Balancer idle timeout](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html)
