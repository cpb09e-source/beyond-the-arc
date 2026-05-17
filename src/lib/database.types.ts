// Hand-rolled DB types matching supabase/schema.sql.
// Regenerate via `npx supabase gen types typescript` once we wire that up.

export type Database = {
  public: {
    Tables: {
      seasons: {
        Row: { year: number; label: string };
        Insert: { year: number; label: string };
        Update: Partial<{ year: number; label: string }>;
      };
      teams: {
        Row: {
          id: number;
          year: number;
          name: string;
          name_normalized: string;
          conference: string | null;
          cbba_team_id: number | null;
          created_at: string;
        };
        Insert: {
          year: number;
          name: string;
          name_normalized: string;
          conference?: string | null;
          cbba_team_id?: number | null;
        };
        Update: Partial<{
          name: string;
          name_normalized: string;
          conference: string | null;
          cbba_team_id: number | null;
        }>;
      };
      team_trank_stats: {
        Row: {
          team_id: number;
          year: number;
          rank: number | null;
          record: string | null;
          wins: number | null;
          losses: number | null;
          adjoe: number | null;
          oe_rank: number | null;
          adjde: number | null;
          de_rank: number | null;
          barthag: number | null;
          proj_w: number | null;
          proj_l: number | null;
          proj_con_w: number | null;
          proj_con_l: number | null;
          conf_record: string | null;
          sos: number | null;
          ncsos: number | null;
          consos: number | null;
          wab: number | null;
          wab_rank: number | null;
          adjt: number | null;
          fun: number | null;
          fun_rank: number | null;
          qual_o: number | null;
          qual_d: number | null;
          qual_barthag: number | null;
          conf_oe: number | null;
          conf_de: number | null;
          conf_win_pct: number | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["team_trank_stats"]["Row"], "updated_at">;
        Update: Partial<Database["public"]["Tables"]["team_trank_stats"]["Row"]>;
      };
      players: {
        Row: {
          id: number;
          year: number;
          team_id: number;
          bart_player_id: number | null;
          cbba_player_id: number | null;
          name: string;
          name_normalized: string;
          class: string | null;
          height: string | null;
          hometown: string | null;
          dob: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["players"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["players"]["Row"]>;
      };
      player_bart_stats: {
        Row: {
          player_id: number;
          year: number;
          games: number | null;
          notes: string | null;
          projection: number | null;
          raw_row: Array<string | number | null> | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["player_bart_stats"]["Row"], "updated_at">;
        Update: Partial<Database["public"]["Tables"]["player_bart_stats"]["Row"]>;
      };
      team_cbba_stats: {
        Row: {
          team_id: number;
          year: number;
          competition_id: number | null;
          raw: Record<string, unknown> | null;
          // four-factor offense
          efg_pct: number | null;
          ts_pct: number | null;
          tov_pct: number | null;
          orb_pct: number | null;
          fta_rate: number | null;
          fg3_pct: number | null;
          fg2_pct: number | null;
          ft_pct: number | null;
          fg3a_rate: number | null;
          ast_pct: number | null;
          // four-factor defense
          efg_pct_def: number | null;
          tov_pct_def: number | null;
          orb_pct_def: number | null;
          fta_rate_def: number | null;
          fg3_pct_def: number | null;
          // ratings
          ortg: number | null;
          drtg: number | null;
          net_rtg: number | null;
          ortg_adj: number | null;
          drtg_adj: number | null;
          net_rtg_adj: number | null;
          // pace
          pace: number | null;
          pace_adj: number | null;
          // volume / context
          gp: number | null;
          poss: number | null;
          sos_cbb: number | null;
          fbpts_pct: number | null;
          pitp_pct: number | null;
          bench_pts_pct: number | null;
          // raw counts
          fg3_made: number | null;
          fg3_attempts: number | null;
          fg3_made_def: number | null;
          fg3_attempts_def: number | null;
          // CBB ready-made *Diff fields (counts)
          fg3_made_diff: number | null;
          fg3_att_diff: number | null;
          fg2_made_diff: number | null;
          fg2_att_diff: number | null;
          fg_made_diff: number | null;
          ft_made_diff: number | null;
          ft_att_diff: number | null;
          reb_diff: number | null;
          orb_diff_ct: number | null;
          drb_diff: number | null;
          tov_diff_ct: number | null;
          fbpts_diff: number | null;
          pitp_diff: number | null;
          pts_diff: number | null;
          scp_diff: number | null;
          potov_diff: number | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["team_cbba_stats"]["Row"], "updated_at">;
        Update: Partial<Database["public"]["Tables"]["team_cbba_stats"]["Row"]>;
      };
      player_cbba_stats: {
        Row: {
          player_id: number;
          year: number;
          competition_id: number | null;
          raw: Record<string, unknown> | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["player_cbba_stats"]["Row"], "updated_at">;
        Update: Partial<Database["public"]["Tables"]["player_cbba_stats"]["Row"]>;
      };
      game_logs: {
        Row: {
          id: number;
          cbba_game_id: string;
          year: number;
          game_date: string | null;
          team_id: number;
          opp_team_id: number | null;
          opp_team_market: string | null;
          is_home: boolean | null;
          is_neutral: boolean | null;
          won: boolean;
          pts_scored: number | null;
          pts_against: number | null;
          pts_diff: number | null;
          poss: number | null;
          pace: number | null;
          fg3_made_diff: number | null;
          fg3_att_diff: number | null;
          fg2_made_diff: number | null;
          fg_made_diff: number | null;
          ft_made_diff: number | null;
          reb_diff: number | null;
          orb_diff: number | null;
          drb_diff: number | null;
          tov_diff: number | null;
          ast_diff: number | null;
          stl_diff: number | null;
          blk_diff: number | null;
          fbpts_diff: number | null;
          pitp_diff: number | null;
          scp_diff: number | null;
          fg3_pct: number | null;
          fg2_pct: number | null;
          ft_pct: number | null;
          efg_pct: number | null;
          ts_pct: number | null;
          fg3_pct_def: number | null;
          efg_pct_def: number | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["game_logs"]["Row"], "id" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["game_logs"]["Row"]>;
      };
      player_game_stats: {
        Row: {
          id: number;
          cbba_game_player_id: string;
          cbba_game_id: number;
          year: number;
          game_date: string | null;
          cbba_player_id: number;
          bart_player_id: number | null;
          full_name: string;
          jersey_num: string | null;
          position: string | null;
          team_id: number;
          opp_team_id: number | null;
          opp_team_market: string | null;
          is_home: boolean | null;
          is_neutral: boolean | null;
          is_starter: boolean | null;
          won: boolean | null;
          mins: number | null;
          poss: number | null;
          pts_scored: number | null;
          fgm: number | null;
          fga: number | null;
          fgm2: number | null;
          fga2: number | null;
          fgm3: number | null;
          fga3: number | null;
          ftm: number | null;
          fta: number | null;
          orb: number | null;
          drb: number | null;
          reb: number | null;
          ast: number | null;
          stl: number | null;
          blk: number | null;
          tov: number | null;
          pf: number | null;
          plus_minus: number | null;
          fg_pct: number | null;
          fg3_pct: number | null;
          ft_pct: number | null;
          efg_pct: number | null;
          ts_pct: number | null;
          usage_pct: number | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["player_game_stats"]["Row"], "id" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["player_game_stats"]["Row"]>;
      };
      player_on_off_stats: {
        Row: {
          id: number;
          cbba_row_id: string;
          year: number;
          competition_id: number;
          cbba_player_id: number;
          bart_player_id: number | null;
          full_name: string;
          team_id: number;
          net_onoff: number | null;
          ortg_onoff: number | null;
          drtg_onoff: number | null;
          mins_on: number | null;
          mins_off: number | null;
          mins_pct: number | null;
          is_qualified: boolean | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["player_on_off_stats"]["Row"], "id" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["player_on_off_stats"]["Row"]>;
      };
      sync_runs: {
        Row: {
          id: number;
          source: string;
          year: number;
          started_at: string;
          finished_at: string | null;
          rows_inserted: number | null;
          rows_updated: number | null;
          notes: string | null;
        };
        Insert: {
          source: string;
          year: number;
          rows_inserted?: number | null;
          rows_updated?: number | null;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["sync_runs"]["Row"]>;
      };
    };
  };
};
