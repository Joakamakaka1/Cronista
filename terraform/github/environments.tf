locals {
  # Each one guards a set of jobs and secrets, and most AWS roles trust one (docs/delivery.md).
  environments = toset(["production", "production-approval", "production-plan", "production-web"])

  owner_user_id = 129002508
}

resource "github_repository_environment" "this" {
  for_each = local.environments

  repository  = github_repository.cronista.name
  environment = each.key

  # GitHub asks for one approval per job that references a protected environment, so the reviewer
  # sits on the one environment that guards a single job. The owner both merges and approves.
  prevent_self_review = false

  dynamic "reviewers" {
    for_each = each.key == "production-approval" ? [local.owner_user_id] : []

    content {
      users = [reviewers.value]
    }
  }

  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

# Only a workflow on master gets each environment's secrets or its OIDC subject.
resource "github_repository_environment_deployment_policy" "master" {
  for_each = local.environments

  repository     = github_repository.cronista.name
  environment    = github_repository_environment.this[each.key].environment
  branch_pattern = "master"
}
