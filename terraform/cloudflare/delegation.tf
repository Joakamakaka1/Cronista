locals {
  domain    = "jcvstro.dev"
  subdomain = "cronista.jcvstro.dev"
}

# The zone CronistaDomain uses now: a replaced one is retained, so a lookup by name would find two.
data "aws_ssm_parameter" "hosted_zone_id" {
  name = "/cronista/prod/domain/hosted-zone-id"
}

data "aws_route53_zone" "cronista" {
  zone_id = nonsensitive(data.aws_ssm_parameter.hosted_zone_id.value)
}

data "cloudflare_zone" "domain" {
  filter = {
    name = local.domain
  }
}

# Replacing the zone changes its name servers, and the next apply moves the delegation with them.
resource "cloudflare_dns_record" "delegation" {
  for_each = toset(data.aws_route53_zone.cronista.name_servers)

  zone_id = data.cloudflare_zone.domain.zone_id
  name    = local.subdomain
  type    = "NS"
  content = each.key
  ttl     = 1
}
