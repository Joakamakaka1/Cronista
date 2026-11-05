
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "action_contents": {
                  Row: {
                    "action_id": number,"created_at": string,"stake": number,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action_id": number,"created_at"?: string,"stake": number,"text": string
                  }
                  Update: {
                    "action_id"?: number,"created_at"?: string,"stake"?: number,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "action_contents_action_id_fkey"
      columns: ["action_id"]
isOneToOne: true
      referencedRelation: "actions"
      referencedColumns: ["id"]
    }
                  ]
                },"actions": {
                  Row: {
                    "character_id": number,"game_day_id": number,"id": number,"origin": Database["public"]['Enums']["action_origin"],"struck_out": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "character_id": number,"game_day_id": number,"id"?: never,"origin": Database["public"]['Enums']["action_origin"],"struck_out"?: boolean
                  }
                  Update: {
                    "character_id"?: number,"game_day_id"?: number,"id"?: never,"origin"?: Database["public"]['Enums']["action_origin"],"struck_out"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "actions_character_id_fkey"
      columns: ["character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "actions_game_day_id_fkey"
      columns: ["game_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at": string,"function_name": string,"game_day": string | null,"id": number,"input_tokens": number,"latency_ms": number,"model": string,"output_tokens": number,"prompt_version": string,"refusal_category": string | null,"workspace": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cache_read_tokens": number,"cache_write_tokens": number,"cost_usd": number,"created_at"?: string,"function_name": string,"game_day"?: string | null,"id"?: never,"input_tokens": number,"latency_ms": number,"model": string,"output_tokens": number,"prompt_version": string,"refusal_category"?: string | null,"workspace": string
                  }
                  Update: {
                    "cache_read_tokens"?: number,"cache_write_tokens"?: number,"cost_usd"?: number,"created_at"?: string,"function_name"?: string,"game_day"?: string | null,"id"?: never,"input_tokens"?: number,"latency_ms"?: number,"model"?: string,"output_tokens"?: number,"prompt_version"?: string,"refusal_category"?: string | null,"workspace"?: string
                  }
                  Relationships: [
                    
                  ]
                },"awards": {
                  Row: {
                    "action_id": number,"id": number,"kind": Database["public"]['Enums']["award_kind"],"points": number
                  }
                  ComputedFields: never
                  Insert: {
                    "action_id": number,"id"?: never,"kind": Database["public"]['Enums']["award_kind"],"points": number
                  }
                  Update: {
                    "action_id"?: number,"id"?: never,"kind"?: Database["public"]['Enums']["award_kind"],"points"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "awards_action_id_fkey"
      columns: ["action_id"]
isOneToOne: true
      referencedRelation: "actions"
      referencedColumns: ["id"]
    }
                  ]
                },"chapters": {
                  Row: {
                    "body": string,"game_day_id": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"game_day_id": number,"title": string
                  }
                  Update: {
                    "body"?: string,"game_day_id"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "chapters_game_day_id_fkey"
      columns: ["game_day_id"]
isOneToOne: true
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    }
                  ]
                },"character_statuses": {
                  Row: {
                    "character_id": number,"game_day_id": number,"status": Database["public"]['Enums']["character_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "character_id": number,"game_day_id": number,"status": Database["public"]['Enums']["character_status"]
                  }
                  Update: {
                    "character_id"?: number,"game_day_id"?: number,"status"?: Database["public"]['Enums']["character_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "character_statuses_character_id_fkey"
      columns: ["character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "character_statuses_game_day_id_fkey"
      columns: ["game_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    }
                  ]
                },"characters": {
                  Row: {
                    "balance": number,"id": number,"nickname": string,"player_id": number,"season_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "balance"?: number,"id"?: never,"nickname": string,"player_id": number,"season_id": number
                  }
                  Update: {
                    "balance"?: number,"id"?: never,"nickname"?: string,"player_id"?: number,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "characters_player_id_fkey"
      columns: ["player_id"]
isOneToOne: false
      referencedRelation: "players"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "characters_season_id_fkey"
      columns: ["season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["id"]
    }
                  ]
                },"charges": {
                  Row: {
                    "action_id": number,"id": number,"points": number,"purpose": Database["public"]['Enums']["charge_purpose"],"recipient_character_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action_id": number,"id"?: never,"points": number,"purpose": Database["public"]['Enums']["charge_purpose"],"recipient_character_id"?: number | null
                  }
                  Update: {
                    "action_id"?: number,"id"?: never,"points"?: number,"purpose"?: Database["public"]['Enums']["charge_purpose"],"recipient_character_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "charges_action_id_fkey"
      columns: ["action_id"]
isOneToOne: false
      referencedRelation: "actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "charges_recipient_character_id_fkey"
      columns: ["recipient_character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    }
                  ]
                },"debts": {
                  Row: {
                    "born_on_day_id": number,"creditor_character_id": number,"debtor_character_id": number,"id": number,"paid_on_day_id": number | null,"points": number
                  }
                  ComputedFields: never
                  Insert: {
                    "born_on_day_id": number,"creditor_character_id": number,"debtor_character_id": number,"id"?: never,"paid_on_day_id"?: number | null,"points": number
                  }
                  Update: {
                    "born_on_day_id"?: number,"creditor_character_id"?: number,"debtor_character_id"?: number,"id"?: never,"paid_on_day_id"?: number | null,"points"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "debts_born_on_day_id_fkey"
      columns: ["born_on_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "debts_creditor_character_id_fkey"
      columns: ["creditor_character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "debts_debtor_character_id_fkey"
      columns: ["debtor_character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "debts_paid_on_day_id_fkey"
      columns: ["paid_on_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    }
                  ]
                },"game_days": {
                  Row: {
                    "closed_at": string | null,"day": string,"id": number,"newspaper_message": string | null,"opened_at": string,"published_at": string | null,"season_id": number,"situation": string,"state": Database["public"]['Enums']["game_day_state"]
                  }
                  ComputedFields: never
                  Insert: {
                    "closed_at"?: string | null,"day": string,"id"?: never,"newspaper_message"?: string | null,"opened_at"?: string,"published_at"?: string | null,"season_id": number,"situation": string,"state"?: Database["public"]['Enums']["game_day_state"]
                  }
                  Update: {
                    "closed_at"?: string | null,"day"?: string,"id"?: never,"newspaper_message"?: string | null,"opened_at"?: string,"published_at"?: string | null,"season_id"?: number,"situation"?: string,"state"?: Database["public"]['Enums']["game_day_state"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "game_days_season_id_fkey"
      columns: ["season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["id"]
    }
                  ]
                },"hints": {
                  Row: {
                    "censored": boolean,"character_id": number,"created_at": string,"game_day_id": number,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "censored"?: boolean,"character_id": number,"created_at"?: string,"game_day_id": number,"text": string
                  }
                  Update: {
                    "censored"?: boolean,"character_id"?: number,"created_at"?: string,"game_day_id"?: number,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "hints_character_id_fkey"
      columns: ["character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "hints_game_day_id_fkey"
      columns: ["game_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    }
                  ]
                },"items": {
                  Row: {
                    "acquired_on_day_id": number,"id": number,"name": string,"owner_character_id": number,"season_id": number
                  }
                  ComputedFields: never
                  Insert: {
                    "acquired_on_day_id": number,"id"?: never,"name": string,"owner_character_id": number,"season_id": number
                  }
                  Update: {
                    "acquired_on_day_id"?: number,"id"?: never,"name"?: string,"owner_character_id"?: number,"season_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "items_acquired_on_day_id_fkey"
      columns: ["acquired_on_day_id"]
isOneToOne: false
      referencedRelation: "game_days"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_owner_character_id_fkey"
      columns: ["owner_character_id"]
isOneToOne: false
      referencedRelation: "characters"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "items_season_id_fkey"
      columns: ["season_id"]
isOneToOne: false
      referencedRelation: "seasons"
      referencedColumns: ["id"]
    }
                  ]
                },"players": {
                  Row: {
                    "created_at": string,"email": string,"id": number,"role": Database["public"]['Enums']["player_role"],"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: never,"role"?: Database["public"]['Enums']["player_role"],"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: never,"role"?: Database["public"]['Enums']["player_role"],"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"seasons": {
                  Row: {
                    "created_at": string,"ends_on": string | null,"id": number,"number": number,"starts_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"ends_on"?: string | null,"id"?: never,"number": number,"starts_on": string
                  }
                  Update: {
                    "created_at"?: string,"ends_on"?: string | null,"id"?: never,"number"?: number,"starts_on"?: string
                  }
                  Relationships: [
                    
                  ]
                },"spend_alerts": {
                  Row: {
                    "cycle_start": string,"sent_at": string,"threshold": number,"workspace": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cycle_start": string,"sent_at"?: string,"threshold": number,"workspace": string
                  }
                  Update: {
                    "cycle_start"?: string,"sent_at"?: string,"threshold"?: number,"workspace"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "begin_close":
{ Args: { "p_game_day_id": number }; Returns: Json
                           },
"create_season":
{ Args: { "p_characters"?: Json,"p_ends_on"?: string,"p_number": number,"p_starts_on": string }; Returns: Json
                           },
"open_game_day":
{ Args: { "p_day": string,"p_season_id": number,"p_situation": string }; Returns: Json
                           },
"postpone_chapter":
{ Args: { "p_game_day_id": number,"p_message": string }; Returns: Json
                           },
"publish_chapter":
{ Args: { "p_body": string,"p_game_day_id": number,"p_resolution": Json,"p_title": string }; Returns: Json
                           },
"spend_by_workspace":
{ Args: { "p_since": string }; Returns: Json
                           },
"store_hint":
{ Args: { "p_censored": boolean,"p_character_id": number,"p_game_day_id": number,"p_text": string }; Returns: Json
                           },
"submit_action":
{ Args: { "p_character_id": number,"p_game_day_id": number,"p_stake": number,"p_text": string }; Returns: Json
                           }
          }
          Enums: {
            "action_origin": "player"|"autopilot","award_kind": "narrator"|"autopilot"|"comic_penalty","character_status": "active"|"out","charge_purpose": "influence"|"item"|"payment","game_day_state": "open"|"postponed"|"published","player_role": "admin"|"player"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "action_origin": ["player", "autopilot"],"award_kind": ["narrator", "autopilot", "comic_penalty"],"character_status": ["active", "out"],"charge_purpose": ["influence", "item", "payment"],"game_day_state": ["open", "postponed", "published"],"player_role": ["admin", "player"]
          }
        }
} as const
