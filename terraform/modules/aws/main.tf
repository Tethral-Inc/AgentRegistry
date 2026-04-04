variable "cockroach_connection_string" {
  type      = string
  sensitive = true
}
variable "slack_webhook_url" {
  type      = string
  sensitive = true
}
variable "region" {
  type    = string
  default = "us-east-1"
}

provider "aws" { region = var.region }

resource "aws_secretsmanager_secret" "signing_seed" {
  name = "acr/signing-key-seed"
}

resource "aws_iam_role" "lambda" {
  name = "acr-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_secrets" {
  name = "acr-secrets"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action   = ["secretsmanager:GetSecretValue"]
      Effect   = "Allow"
      Resource = aws_secretsmanager_secret.signing_seed.arn
    }]
  })
}

resource "aws_sqs_queue" "dlq" {
  name                      = "acr-lambda-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sns_topic" "alerts" { name = "acr-alerts" }

# Sprint 0 Lambdas: health_check and partition_creator

resource "aws_lambda_function" "health_check" {
  function_name = "acr-health-check"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 10
  memory_size   = 128
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = {
      COCKROACH_CONNECTION_STRING = var.cockroach_connection_string
      SLACK_WEBHOOK_URL           = var.slack_webhook_url
      ACR_API_URL                 = "https://acr.tethral.ai"
    }
  }
  lifecycle { ignore_changes = [filename] }

  tags = {
    managed_by = "terraform"
    project    = "acr"
  }
}

resource "aws_cloudwatch_event_rule" "health_check" {
  name                = "acr-health-check"
  schedule_expression = "rate(5 minutes)"
}
resource "aws_cloudwatch_event_target" "health_check" {
  rule = aws_cloudwatch_event_rule.health_check.name
  arn  = aws_lambda_function.health_check.arn
}
resource "aws_lambda_permission" "health_check" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health_check.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.health_check.arn
}

resource "aws_lambda_function" "partition_creator" {
  function_name = "acr-partition-creator"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 60
  memory_size   = 128
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = { COCKROACH_CONNECTION_STRING = var.cockroach_connection_string }
  }
  lifecycle { ignore_changes = [filename] }

  tags = {
    managed_by = "terraform"
    project    = "acr"
  }
}

resource "aws_cloudwatch_event_rule" "partition_creator" {
  name                = "acr-partition-creator"
  schedule_expression = "cron(0 0 25 * ? *)"
}
resource "aws_cloudwatch_event_target" "partition_creator" {
  rule = aws_cloudwatch_event_rule.partition_creator.name
  arn  = aws_lambda_function.partition_creator.arn
}
resource "aws_lambda_permission" "partition_creator" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.partition_creator.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.partition_creator.arn
}

# Sprint 1 Lambdas

resource "aws_lambda_function" "skill_threat_update" {
  function_name = "acr-skill-threat-update"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 120
  memory_size   = 256
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = {
      COCKROACH_CONNECTION_STRING = var.cockroach_connection_string
      SLACK_WEBHOOK_URL           = var.slack_webhook_url
    }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "skill_threat_update" {
  name                = "acr-skill-threat-update"
  schedule_expression = "rate(30 minutes)"
}
resource "aws_cloudwatch_event_target" "skill_threat_update" {
  rule = aws_cloudwatch_event_rule.skill_threat_update.name
  arn  = aws_lambda_function.skill_threat_update.arn
}
resource "aws_lambda_permission" "skill_threat_update" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.skill_threat_update.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.skill_threat_update.arn
}

resource "aws_lambda_function" "system_health_aggregate" {
  function_name = "acr-system-health-aggregate"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 120
  memory_size   = 256
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = {
      COCKROACH_CONNECTION_STRING = var.cockroach_connection_string
    }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "system_health_aggregate" {
  name                = "acr-system-health-aggregate"
  schedule_expression = "rate(15 minutes)"
}
resource "aws_cloudwatch_event_target" "system_health_aggregate" {
  rule = aws_cloudwatch_event_rule.system_health_aggregate.name
  arn  = aws_lambda_function.system_health_aggregate.arn
}
resource "aws_lambda_permission" "system_health_aggregate" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.system_health_aggregate.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.system_health_aggregate.arn
}

# Sprint 1.5 Lambda

resource "aws_lambda_function" "clawhub_crawl" {
  function_name = "acr-clawhub-crawl"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300
  memory_size   = 512
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = {
      COCKROACH_CONNECTION_STRING = var.cockroach_connection_string
    }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "clawhub_crawl" {
  name                = "acr-clawhub-crawl"
  schedule_expression = "cron(0 1 * * ? *)"
}
resource "aws_cloudwatch_event_target" "clawhub_crawl" {
  rule = aws_cloudwatch_event_rule.clawhub_crawl.name
  arn  = aws_lambda_function.clawhub_crawl.arn
}
resource "aws_lambda_permission" "clawhub_crawl" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.clawhub_crawl.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.clawhub_crawl.arn
}

# Sprint 3 Lambdas

resource "aws_lambda_function" "agent_expiration" {
  function_name = "acr-agent-expiration"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 120
  memory_size   = 128
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = { COCKROACH_CONNECTION_STRING = var.cockroach_connection_string }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "agent_expiration" {
  name                = "acr-agent-expiration"
  schedule_expression = "cron(0 3 * * ? *)"
}
resource "aws_cloudwatch_event_target" "agent_expiration" {
  rule = aws_cloudwatch_event_rule.agent_expiration.name
  arn  = aws_lambda_function.agent_expiration.arn
}
resource "aws_lambda_permission" "agent_expiration" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_expiration.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.agent_expiration.arn
}

resource "aws_lambda_function" "data_archival" {
  function_name = "acr-data-archival"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300
  memory_size   = 256
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = { COCKROACH_CONNECTION_STRING = var.cockroach_connection_string }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "data_archival" {
  name                = "acr-data-archival"
  schedule_expression = "cron(0 4 * * ? *)"
}
resource "aws_cloudwatch_event_target" "data_archival" {
  rule = aws_cloudwatch_event_rule.data_archival.name
  arn  = aws_lambda_function.data_archival.arn
}
resource "aws_lambda_permission" "data_archival" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_archival.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.data_archival.arn
}

# Sprint 4 Lambda

resource "aws_lambda_function" "friction_baseline_compute" {
  function_name = "acr-friction-baseline-compute"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  timeout       = 300
  memory_size   = 512
  filename      = "${path.module}/placeholder.zip"
  dead_letter_config { target_arn = aws_sqs_queue.dlq.arn }
  environment {
    variables = { COCKROACH_CONNECTION_STRING = var.cockroach_connection_string }
  }
  lifecycle { ignore_changes = [filename] }
  tags = { managed_by = "terraform", project = "acr" }
}

resource "aws_cloudwatch_event_rule" "friction_baseline_compute" {
  name                = "acr-friction-baseline-compute"
  schedule_expression = "cron(0 2 * * ? *)"
}
resource "aws_cloudwatch_event_target" "friction_baseline_compute" {
  rule = aws_cloudwatch_event_rule.friction_baseline_compute.name
  arn  = aws_lambda_function.friction_baseline_compute.arn
}
resource "aws_lambda_permission" "friction_baseline_compute" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.friction_baseline_compute.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.friction_baseline_compute.arn
}
