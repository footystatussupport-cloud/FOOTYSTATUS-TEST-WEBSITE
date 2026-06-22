
-- Create enum for account types
CREATE TYPE public.account_type AS ENUM ('player', 'team', 'coach', 'scout', 'trainer', 'academy_director', 'parent');

-- Create enum for coaching levels
CREATE TYPE public.coaching_level AS ENUM ('grassroots', 'academy', 'semi_pro', 'pro');

-- Create user_roles table to track account types
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role account_type NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Create player_profiles table
CREATE TABLE public.player_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    date_of_birth DATE,
    position TEXT,
    team TEXT,
    height TEXT,
    weight TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    school_grade TEXT,
    preferred_foot TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create team_profiles table
CREATE TABLE public.team_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    club_name TEXT NOT NULL,
    leagues_offered TEXT[],
    founded_year INTEGER,
    country TEXT,
    city TEXT,
    home_stadium TEXT,
    training_ground TEXT,
    age_groups_offered TEXT[],
    contact_email TEXT,
    contact_phone TEXT,
    verified_status BOOLEAN DEFAULT false,
    logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create team_staff table for admin & staff members
CREATE TABLE public.team_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_profile_id UUID REFERENCES public.team_profiles(id) ON DELETE CASCADE NOT NULL,
    staff_name TEXT NOT NULL,
    staff_role TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create staff_profiles table (for coach/scout/team employee)
CREATE TABLE public.staff_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role account_type NOT NULL,
    team_organization_name TEXT,
    country TEXT,
    city TEXT,
    coaching_level coaching_level,
    years_experience INTEGER,
    coaching_licenses TEXT[],
    age_groups_coached TEXT[],
    contact_email TEXT,
    contact_phone TEXT,
    previous_teams TEXT[],
    notable_achievements TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create parent_profiles table
CREATE TABLE public.parent_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    relationship_to_player TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create parent_player_links table to link parents to their players
CREATE TABLE public.parent_player_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_profile_id UUID REFERENCES public.parent_profiles(id) ON DELETE CASCADE NOT NULL,
    player_profile_id UUID REFERENCES public.player_profiles(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (parent_profile_id, player_profile_id)
);

-- Enable RLS on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_player_links ENABLE ROW LEVEL SECURITY;

-- Security definer function to check account type
CREATE OR REPLACE FUNCTION public.has_account_type(_user_id UUID, _role account_type)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to check if user is staff (coach/scout/trainer/academy_director/team)
CREATE OR REPLACE FUNCTION public.is_staff_member(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('coach', 'scout', 'trainer', 'academy_director', 'team')
  )
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own role"
ON public.user_roles FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for player_profiles
-- Public info viewable by everyone (except phone)
CREATE POLICY "Player profiles are viewable by everyone"
ON public.player_profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own player profile"
ON public.player_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own player profile"
ON public.player_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- RLS Policies for team_profiles
CREATE POLICY "Team profiles are viewable by everyone"
ON public.team_profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own team profile"
ON public.team_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own team profile"
ON public.team_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- RLS Policies for team_staff
CREATE POLICY "Team staff viewable by everyone"
ON public.team_staff FOR SELECT
USING (true);

CREATE POLICY "Team owners can manage staff"
ON public.team_staff FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.team_profiles
    WHERE id = team_profile_id AND user_id = auth.uid()
  )
);

-- RLS Policies for staff_profiles
CREATE POLICY "Staff profiles are viewable by everyone"
ON public.staff_profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own staff profile"
ON public.staff_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own staff profile"
ON public.staff_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- RLS Policies for parent_profiles
CREATE POLICY "Parent profiles are viewable by everyone"
ON public.parent_profiles FOR SELECT
USING (true);

CREATE POLICY "Users can insert their own parent profile"
ON public.parent_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own parent profile"
ON public.parent_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- RLS Policies for parent_player_links
CREATE POLICY "Parent player links viewable by involved parties"
ON public.parent_player_links FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.parent_profiles WHERE id = parent_profile_id AND user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.player_profiles WHERE id = player_profile_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Parents can create links to players"
ON public.parent_player_links FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.parent_profiles WHERE id = parent_profile_id AND user_id = auth.uid()
  )
);

-- Create view for player profiles that hides phone from non-staff
CREATE VIEW public.player_profiles_public
WITH (security_invoker = on) AS
SELECT 
    id,
    user_id,
    full_name,
    date_of_birth,
    position,
    team,
    height,
    weight,
    contact_email,
    CASE 
        WHEN public.is_staff_member(auth.uid()) THEN contact_phone
        ELSE NULL
    END as contact_phone,
    school_grade,
    preferred_foot,
    profile_image_url,
    created_at,
    updated_at
FROM public.player_profiles;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_player_profiles_updated_at
    BEFORE UPDATE ON public.player_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_team_profiles_updated_at
    BEFORE UPDATE ON public.team_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_staff_profiles_updated_at
    BEFORE UPDATE ON public.staff_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_parent_profiles_updated_at
    BEFORE UPDATE ON public.parent_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();
