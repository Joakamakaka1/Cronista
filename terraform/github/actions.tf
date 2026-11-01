resource "github_actions_repository_permissions" "cronista" {
  repository           = github_repository.cronista.name
  enabled              = true
  allowed_actions      = "selected"
  sha_pinning_required = true

  allowed_actions_config {
    github_owned_allowed = true
    verified_allowed     = false
    patterns_allowed     = ["aws-actions/configure-aws-credentials@*", "pnpm/action-setup@*"]
  }
}

resource "github_workflow_repository_permissions" "cronista" {
  repository                       = github_repository.cronista.name
  default_workflow_permissions     = "read"
  can_approve_pull_request_reviews = false
}
